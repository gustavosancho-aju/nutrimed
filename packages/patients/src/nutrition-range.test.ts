import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@nutrimed/db';
import {
  addFoodLogEntry,
  setNutritionGoal,
  softDeleteFoodLogEntry,
  listNutritionDiary,
  listNutritionRange,
} from './patients';

/**
 * `listNutritionRange` — base do histórico de 12 meses (2026-07-24).
 *
 * Dois contratos:
 * 1. RESULTADO idêntico ao `listNutritionDiary` (que busca dia a dia) — a
 *    otimização não pode mudar o que o médico vê.
 * 2. CUSTO fixo: 2 consultas, independente do tamanho do período. O laço antigo
 *    fazia 2 por dia (12 meses ≈ 730), o que congelaria o Modo Apresentação.
 */

const KEY = randomBytes(32);
const TZ = -180; // BR

/** Envolve o executor contando as consultas emitidas. */
function counting(exec: SqlExecutor): { exec: SqlExecutor; count: () => number } {
  let n = 0;
  return {
    exec: {
      query: (sql: string, params?: unknown[]) => {
        n += 1;
        return exec.query(sql, params as never);
      },
    } as SqlExecutor,
    count: () => n,
  };
}

/** Meio-dia local do dia informado (evita ambiguidade de borda de fuso). */
function noonOf(dayISO: string): Date {
  return new Date(`${dayISO}T15:00:00Z`); // 12:00 em UTC-3
}

describe('listNutritionRange', () => {
  let exec: SqlExecutor;
  let patientId: string;
  let userId: string;

  beforeAll(async () => {
    exec = pgliteExecutor(new PGlite());
    await runMigrations(exec);
    const user = await exec.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash) VALUES ('m@t.dev','Med','x') RETURNING id",
    );
    userId = user.rows[0]!.id;
    const patient = await exec.query<{ id: string }>(
      'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
      [userId, 'enc'],
    );
    patientId = patient.rows[0]!.id;

    // Metas versionadas: 1800 a partir de jan, 2200 a partir de fev.
    await setNutritionGoal(exec, patientId, userId, '2026-01-01', { kcal: 1800, protein: 120, carbs: 200, fat: 60 }, KEY);
    await setNutritionGoal(exec, patientId, userId, '2026-02-01', { kcal: 2200, protein: 150, carbs: 240, fat: 70 }, KEY);

    // Lançamentos espalhados por 3 meses (inclusive um removido pelo médico).
    for (const [dayISO, kcal] of [
      ['2026-01-10', 1800],
      ['2026-01-11', 900],
      ['2026-02-05', 2200],
      ['2026-03-20', 1500],
    ] as const) {
      await addFoodLogEntry(
        exec,
        patientId,
        { eatenAt: noonOf(dayISO), values: { kcal, protein: 10, carbs: 20, fat: 5 } },
        KEY,
      );
    }
    // 2 lançamentos no MESMO dia (soma) + 1 que será removido
    await addFoodLogEntry(
      exec,
      patientId,
      { eatenAt: noonOf('2026-01-10'), values: { kcal: 200, protein: 5, carbs: 10, fat: 2 } },
      KEY,
    );
    const removida = await addFoodLogEntry(
      exec,
      patientId,
      { eatenAt: noonOf('2026-02-05'), values: { kcal: 9999, protein: 0, carbs: 0, fat: 0 } },
      KEY,
    );
    await softDeleteFoodLogEntry(exec, patientId, removida);
  });

  it('produz EXATAMENTE o mesmo resultado do laço dia a dia', async () => {
    const days: string[] = [];
    for (let d = 1; d <= 28; d += 1) days.push(`2026-02-${String(d).padStart(2, '0')}`);

    const antigo = await listNutritionDiary(exec, patientId, days, TZ, KEY);
    const novo = await listNutritionRange(exec, patientId, '2026-02-01', '2026-02-28', TZ, KEY);

    expect(novo).toHaveLength(antigo.length);
    expect(novo.map((d) => d.day)).toEqual(antigo.map((d) => d.day));
    expect(novo.map((d) => d.progress.consumed)).toEqual(antigo.map((d) => d.progress.consumed));
    expect(novo.map((d) => d.progress.goal)).toEqual(antigo.map((d) => d.progress.goal));
    expect(novo.map((d) => d.entries.map((e) => e.id))).toEqual(
      antigo.map((d) => d.entries.map((e) => e.id)),
    );
  });

  it('CUSTO FIXO: 2 consultas para 12 meses (o laço antigo faria ~730)', async () => {
    const doze = counting(exec);
    await listNutritionRange(doze.exec, patientId, '2025-08-01', '2026-07-31', TZ, KEY);
    expect(doze.count()).toBe(2);

    // e o mesmo custo para 1 mês — não escala com o período
    const um = counting(exec);
    await listNutritionRange(um.exec, patientId, '2026-02-01', '2026-02-28', TZ, KEY);
    expect(um.count()).toBe(2);
  });

  it('usa a meta VIGENTE em cada dia (histórico fiel à versão da meta)', async () => {
    const range = await listNutritionRange(exec, patientId, '2026-01-30', '2026-02-02', TZ, KEY);
    const byDay = new Map(range.map((d) => [d.day, d]));

    expect(byDay.get('2026-01-31')!.progress.goal?.kcal).toBe(1800);
    expect(byDay.get('2026-02-01')!.progress.goal?.kcal).toBe(2200);
  });

  it('soma vários lançamentos do mesmo dia e IGNORA o removido pelo médico', async () => {
    const range = await listNutritionRange(exec, patientId, '2026-01-10', '2026-02-05', TZ, KEY);
    const byDay = new Map(range.map((d) => [d.day, d]));

    expect(byDay.get('2026-01-10')!.progress.consumed.kcal).toBe(2000); // 1800 + 200
    expect(byDay.get('2026-02-05')!.progress.consumed.kcal).toBe(2200); // sem os 9999 removidos
  });

  it('preenche dias sem lançamento (o histórico não tem buracos)', async () => {
    const range = await listNutritionRange(exec, patientId, '2026-03-01', '2026-03-31', TZ, KEY);
    expect(range).toHaveLength(31);
    expect(range.filter((d) => d.entries.length > 0)).toHaveLength(1); // só 20/03
    expect(range.every((d) => d.progress.goal?.kcal === 2200)).toBe(true);
  });

  it('atravessa virada de ano sem caso especial', async () => {
    const range = await listNutritionRange(exec, patientId, '2025-12-30', '2026-01-02', TZ, KEY);
    expect(range.map((d) => d.day)).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(range[0]!.progress.goal).toBeNull(); // antes da 1ª meta
    expect(range[3]!.progress.goal?.kcal).toBe(1800);
  });

  it('intervalo invertido ⇒ vazio, sem consultar o banco', async () => {
    const c = counting(exec);
    expect(await listNutritionRange(c.exec, patientId, '2026-05-10', '2026-05-01', TZ, KEY)).toEqual([]);
    expect(c.count()).toBe(0);
  });
});
