import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@nutrimed/db';
import { setNutritionGoal, sumFoodLogForDay } from '@nutrimed/patients';
import { createPairingCode, redeemPairingCode } from '@nutrimed/telegram-link';
import { FakeFoodEstimator, type FoodImageInput } from '@nutrimed/food-vision';
import { FakeLlmProvider, type ILlmProvider } from '@nutrimed/providers';
import {
  handleStart,
  handlePhoto,
  handleCorrection,
  handleToday,
  handleGoal,
  handleUpdate,
  type BotDeps,
} from './bot';


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
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'medico@nutrimed.test');
    deps = {
      db: exec,
      key: KEY,
      estimator: new FakeFoodEstimator(),
      now: NOW,
      tzOffsetMinutes: -180,
      downloadPhoto: async () => IMAGE, // transporte fake: /corrigir re-baixa a foto pelo photoRef
    };
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

  describe('legenda da foto e /corrigir', () => {
    it('foto com legenda: a descrição do paciente orienta a estimativa', async () => {
      await pairNewChat('chat-caption');
      const r = await handleUpdate(deps, {
        chatId: 'chat-caption',
        photo: IMAGE,
        photoRef: 'f-cap',
        caption: 'frango grelhado com arroz',
      });
      expect(r?.text).toContain('frango grelhado com arroz'); // itemsLabel do fake reflete a legenda
    });

    it('/corrigir: reestima a mesma foto e ATUALIZA a entrada (não duplica o consumo)', async () => {
      const patientId = await pairNewChat('chat-fix');
      await handlePhoto(deps, 'chat-fix', IMAGE, 'tg-file-fix'); // 620 kcal (fake sem hint)

      const r = await handleCorrection(deps, 'chat-fix', 'era frango grelhado, não peixe');
      expect(r.text).toMatch(/ajustad/i);
      expect(r.text).toContain('era frango grelhado, não peixe'); // itemsLabel reflete a correção
      expect(r.text).toContain('não substitui'); // disclaimer segue presente (ADR-015)

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(580); // substituiu os 620 do registro original — não somou
    });

    it('/corrigir corrige a última entrada, preservando as anteriores do dia', async () => {
      const patientId = await pairNewChat('chat-fix-2x');
      await handlePhoto(deps, 'chat-fix-2x', IMAGE, 'tg-a'); // 620
      await handlePhoto(deps, 'chat-fix-2x', IMAGE, 'tg-b'); // 620
      await handleCorrection(deps, 'chat-fix-2x', 'era frango'); // última vira 580

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(620 + 580);
    });

    it('/corrigir sem texto: explica o uso', async () => {
      await pairNewChat('chat-fix-empty');
      const r = await handleCorrection(deps, 'chat-fix-empty', '');
      expect(r.text).toMatch(/\/corrigir/);
    });

    it('/corrigir sem prato registrado hoje: orienta enviar a foto primeiro', async () => {
      await pairNewChat('chat-fix-none');
      const r = await handleCorrection(deps, 'chat-fix-none', 'era frango');
      expect(r.text).toMatch(/n[ãa]o encontrei/i);
    });

    it('/corrigir sem photoRef salvo: pede o reenvio da foto com legenda', async () => {
      await pairNewChat('chat-fix-noref');
      await handlePhoto(deps, 'chat-fix-noref', IMAGE); // sem photoRef
      const r = await handleCorrection(deps, 'chat-fix-noref', 'era frango');
      expect(r.text).toMatch(/envie a foto novamente/i);
    });

    it('/corrigir sem pareamento: nega e instrui parear', async () => {
      const r = await handleCorrection(deps, 'chat-fix-unpaired', 'era frango');
      expect(r.text).toMatch(/n[ãa]o est[áa] ativo/i);
    });

    it('resposta da foto convida a corrigir (/corrigir descoberto no fluxo)', async () => {
      await pairNewChat('chat-fix-tip');
      const r = await handlePhoto(deps, 'chat-fix-tip', IMAGE, 'tg-tip');
      expect(r.text).toContain('/corrigir');
    });

    it('dispatcher roteia /corrigir', async () => {
      await pairNewChat('chat-fix-disp');
      await handleUpdate(deps, { chatId: 'chat-fix-disp', photo: IMAGE, photoRef: 'f-d' });
      const r = await handleUpdate(deps, { chatId: 'chat-fix-disp', text: '/corrigir era frango' });
      expect(r?.text).toMatch(/ajustad/i);
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

    it('aceita comandos com menção (/comando@Bot — forma usada em grupos)', async () => {
      // Pareia o "grupo" via /start@Bot CÓDIGO — o @Bot não pode vazar no argumento.
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);
      const start = await handleUpdate(deps, { chatId: 'chat-group', text: `/start@RafaNutriBot ${code}` });
      expect(start?.text).toMatch(/ativado/i);

      const hoje = await handleUpdate(deps, { chatId: 'chat-group', text: '/hoje@RafaNutriBot' });
      expect(hoje?.text).toMatch(/hoje/i);

      const meta = await handleUpdate(deps, { chatId: 'chat-group', text: '/meta@RafaNutriBot' });
      expect(meta?.text).toMatch(/meta|ainda n[ãa]o definiu/i);

      // /start@Bot sem código = boas-vindas (não confunde a menção com um código)
      const welcome = await handleUpdate(deps, { chatId: 'chat-group-2', text: '/start@RafaNutriBot' });
      expect(welcome?.text).toMatch(/c[óo]digo de\s*v[íi]nculo/i);
    });
  });
});
