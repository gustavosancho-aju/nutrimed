import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { setNutritionGoal, sumFoodLogForDay } from '@nutrimed/patients';
import { createPairingCode, redeemPairingCode } from '@nutrimed/telegram-link';
import { FakeFoodEstimator, type FoodImageInput } from '@nutrimed/food-vision';
import { FakeLlmProvider, type ILlmProvider } from '@nutrimed/providers';
import {
  handleStart,
  handlePhoto,
  handleToday,
  handleGoal,
  handleUpdate,
  type BotDeps,
} from './bot';

function fromPglite(db: PGlite): SqlExecutor {
  return {
    exec: async (sql: string): Promise<void> => {
      await db.exec(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await db.query<T>(text, params as unknown[]);
      return { rows: result.rows };
    },
  };
}

const KEY = randomBytes(32);
const IMAGE: FoodImageInput = { base64: 'x', mediaType: 'image/jpeg' };
const NOW = () => new Date('2026-07-01T12:00:00Z');

async function insertUser(exec: SqlExecutor, email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Dra. Demo', 'x'],
  );
  return res.rows[0]!.id;
}

async function insertPatient(exec: SqlExecutor, userId: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
    [userId, 'enc-name'],
  );
  return res.rows[0]!.id;
}

describe('Telegram Bot — lógica pura (E12 — 12.6)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let deps: BotDeps;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'medico@nutrimed.test');
    deps = { db: exec, key: KEY, estimator: new FakeFoodEstimator(), now: NOW, tzOffsetMinutes: -180 };
  });

  afterAll(async () => {
    await db.close();
  });

  /** Vincula um chat a um paciente novo e retorna o patientId. */
  async function pairNewChat(chatId: string): Promise<string> {
    const patientId = await insertPatient(exec, userId);
    const code = await createPairingCode(exec, patientId, userId);
    await redeemPairingCode(exec, chatId, code);
    return patientId;
  }

  describe('/start — boas-vindas e pareamento', () => {
    it('sem código: dá boas-vindas e explica o pareamento', async () => {
      const r = await handleStart(deps, 'chat-welcome');
      expect(r.text).toMatch(/c[óo]digo/i);
      expect(r.text).toMatch(/\/start/i);
    });

    it('código válido: ativa o canal', async () => {
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);
      const r = await handleStart(deps, 'chat-start-ok', code);
      expect(r.text).toMatch(/ativad/i);
    });

    it('código inválido: orienta pedir um novo', async () => {
      const r = await handleStart(deps, 'chat-start-bad', 'ZZZZZZZZ');
      expect(r.text).toMatch(/inv[áa]lido/i);
      expect(r.text).toMatch(/novo c[óo]digo/i);
    });
  });

  describe('foto do prato', () => {
    it('sem pareamento: nega e instrui parear (não registra)', async () => {
      const r = await handlePhoto(deps, 'chat-unpaired', IMAGE);
      expect(r.text).toMatch(/n[ãa]o est[áa] ativo/i);
    });

    it('pareado: estima, registra (cifrado/auditado) e responde com disclaimer', async () => {
      const patientId = await pairNewChat('chat-photo');
      const r = await handlePhoto(deps, 'chat-photo', IMAGE, 'tg-file-1');

      expect(r.text).toMatch(/kcal/);
      expect(r.text).toContain('não substitui'); // disclaimer obrigatório (ADR-015)

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(620); // valor do FakeFoodEstimator
    });

    it('pareado com meta: mostra o quanto falta', async () => {
      const patientId = await pairNewChat('chat-photo-goal');
      await setNutritionGoal(exec, patientId, userId, '2026-07-01', { kcal: 2000, protein: 150, carbs: 200, fat: 60 }, KEY);
      const r = await handlePhoto(deps, 'chat-photo-goal', IMAGE);
      expect(r.text).toMatch(/faltam/i);
    });

    it('estimador indisponível (null): degrada com aviso, sem quebrar', async () => {
      await pairNewChat('chat-no-est');
      const depsNoEst: BotDeps = { ...deps, estimator: null };
      const r = await handlePhoto(depsNoEst, 'chat-no-est', IMAGE);
      expect(r.text).toMatch(/indispon[íi]vel/i);
    });
  });

  describe('/hoje e /meta', () => {
    it('/hoje: mostra o progresso do dia', async () => {
      await pairNewChat('chat-hoje');
      const r = await handleToday(deps, 'chat-hoje');
      expect(r.text).toMatch(/hoje/i);
    });

    it('/meta sem meta definida: informa (não inventa — ADR-015)', async () => {
      await pairNewChat('chat-meta-none');
      const r = await handleGoal(deps, 'chat-meta-none');
      expect(r.text).toMatch(/ainda n[ãa]o definiu/i);
    });

    it('/meta com meta: mostra os alvos', async () => {
      const patientId = await pairNewChat('chat-meta-ok');
      await setNutritionGoal(exec, patientId, userId, '2026-07-01', { kcal: 1800, protein: 140, carbs: 170, fat: 55 }, KEY);
      const r = await handleGoal(deps, 'chat-meta-ok');
      expect(r.text).toMatch(/1800/);
    });
  });

  describe('orientação por IA (12.8)', () => {
    it('com llm: acrescenta a frase de orientação e mantém o disclaimer', async () => {
      await pairNewChat('chat-ia');
      const depsIa: BotDeps = { ...deps, llm: new FakeLlmProvider() };
      const r = await handlePhoto(depsIa, 'chat-ia', IMAGE);
      expect(r.text).toContain('[aurelio]'); // marcador determinístico do FakeLlmProvider
      expect(r.text).toContain('não substitui'); // disclaimer segue presente (ADR-015)
    });

    it('/hoje com llm também traz orientação', async () => {
      await pairNewChat('chat-ia-hoje');
      const depsIa: BotDeps = { ...deps, llm: new FakeLlmProvider() };
      const r = await handleToday(depsIa, 'chat-ia-hoje');
      expect(r.text).toContain('[aurelio]');
    });

    it('sem llm: degrada para feedback factual (sem frase de IA), com disclaimer', async () => {
      await pairNewChat('chat-sem-ia');
      const r = await handlePhoto(deps, 'chat-sem-ia', IMAGE); // deps sem llm
      expect(r.text).not.toContain('[aurelio]');
      expect(r.text).toMatch(/kcal/);
      expect(r.text).toContain('não substitui');
    });

    it('llm que falha: degrada sem quebrar (mantém factual + disclaimer)', async () => {
      await pairNewChat('chat-ia-erro');
      const brokenLlm: ILlmProvider = {
        async complete() {
          throw new Error('llm indisponível');
        },
      };
      const depsErr: BotDeps = { ...deps, llm: brokenLlm };
      const r = await handlePhoto(depsErr, 'chat-ia-erro', IMAGE);
      expect(r.text).toMatch(/kcal/);
      expect(r.text).toContain('não substitui');
    });
  });

  describe('handleUpdate — dispatcher', () => {
    it('roteia foto, /hoje, /meta, texto desconhecido e vazio', async () => {
      await pairNewChat('chat-disp');

      const foto = await handleUpdate(deps, { chatId: 'chat-disp', photo: IMAGE, photoRef: 'f1' });
      expect(foto?.text).toMatch(/kcal/);

      const hoje = await handleUpdate(deps, { chatId: 'chat-disp', text: '/hoje' });
      expect(hoje?.text).toMatch(/hoje/i);

      const meta = await handleUpdate(deps, { chatId: 'chat-disp', text: '/meta' });
      expect(meta?.text).toMatch(/meta|ainda n[ãa]o definiu/i);

      const help = await handleUpdate(deps, { chatId: 'chat-disp', text: 'oi tudo bem?' });
      expect(help?.text).toMatch(/n[ãa]o entendi/i);

      const vazio = await handleUpdate(deps, { chatId: 'chat-disp' });
      expect(vazio).toBeNull();
    });
  });
});
