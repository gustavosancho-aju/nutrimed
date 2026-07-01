import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { setNutritionGoal } from '@nutrimed/patients';
import { createPairingCode } from '@nutrimed/telegram-link';
import { FakeFoodEstimator, type FoodImageInput } from '@nutrimed/food-vision';
import { handleStart, handlePhoto, handleToday, handleGoal, type BotDeps } from './bot';

/**
 * Teste de integração da JORNADA COMPLETA do paciente (E2E interno — E12).
 * Atravessa todos os pacotes: metas (@nutrimed/patients) → pareamento/gate
 * (@nutrimed/telegram-link) → estimativa por foto (@nutrimed/food-vision) →
 * lógica do bot (handlers). Estimador fake (determinístico) e relógio fixo.
 * Imprime as respostas reais do bot para inspeção.
 */

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
const CHAT = 'chat-e2e';

describe('Jornada completa do paciente (E2E interno)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let patientId: string;
  let deps: BotDeps;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    const u = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutri@nutrimed.test', 'Dra. Demo', 'x'],
    );
    userId = u.rows[0]!.id;
    const p = await exec.query<{ id: string }>(
      'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
      [userId, 'enc-name'],
    );
    patientId = p.rows[0]!.id;
    deps = {
      db: exec,
      key: KEY,
      estimator: new FakeFoodEstimator(),
      now: () => new Date('2026-07-01T12:00:00Z'),
      tzOffsetMinutes: -180,
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('nutricionista define meta → paciente pareia → envia foto → recebe estimativa vs. meta', async () => {
    // 1) Nutricionista define as metas na ficha (UI 12.4 → serviço 12.2).
    await setNutritionGoal(
      exec,
      patientId,
      userId,
      '2026-07-01',
      { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
      KEY,
    );

    // 2) Nutricionista gera o código de pareamento (UI 12.4 → 12.3).
    const code = await createPairingCode(exec, patientId, userId);
    console.log(`\n===== JORNADA DO PACIENTE (E2E interno) =====`);
    console.log(`[nutricionista gera código] → /start ${code}`);

    // 3) Paciente envia /start CÓDIGO no Telegram.
    const started = await handleStart(deps, CHAT, code);
    console.log(`\n[paciente envia] /start ${code}`);
    console.log(`[bot responde] →\n${started.text}`);
    expect(started.text).toMatch(/ativad/i);

    // 4) Paciente envia a foto do prato.
    const photo = await handlePhoto(deps, CHAT, IMAGE, 'tg-file-1');
    console.log(`\n[paciente envia] 📷 foto do prato`);
    console.log(`[bot responde] →\n${photo.text}`);
    expect(photo.text).toMatch(/kcal/);
    expect(photo.text).toMatch(/faltam/i); // progresso vs. meta
    expect(photo.text).toContain('não substitui'); // disclaimer (ADR-015)

    // 5) Paciente consulta /hoje.
    const hoje = await handleToday(deps, CHAT);
    console.log(`\n[paciente envia] /hoje`);
    console.log(`[bot responde] →\n${hoje.text}`);
    expect(hoje.text).toMatch(/hoje/i);

    // 6) Paciente consulta /meta.
    const meta = await handleGoal(deps, CHAT);
    console.log(`\n[paciente envia] /meta`);
    console.log(`[bot responde] →\n${meta.text}`);
    console.log(`\n============================================\n`);
    expect(meta.text).toMatch(/2000/);
  });

  it('segunda foto acumula no mesmo dia (consumo somado vs. meta)', async () => {
    const primeira = await handleToday(deps, CHAT);
    await handlePhoto(deps, CHAT, IMAGE); // + 620 kcal (fake)
    const depois = await handleToday(deps, CHAT);
    // 2 fotos de 620 kcal ⇒ 1240 consumidas; "faltam ~760".
    expect(depois.text).toMatch(/1240/);
    expect(primeira.text).not.toEqual(depois.text);
  });

  it('gate: chat NÃO pareado não processa foto (default NEGA — ADR-013)', async () => {
    const r = await handlePhoto(deps, 'chat-desconhecido', IMAGE);
    expect(r.text).toMatch(/não está ativo/i);
  });
});
