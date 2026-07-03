import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@nutrimed/db';
import { getAuditTrail } from '@nutrimed/audit';
import {
  createPatient,
  setNutritionGoal,
  loadCurrentNutritionGoal,
  listNutritionGoalHistory,
  addFoodLogEntry,
  findLatestFoodLogEntry,
  updateFoodLogEntryValues,
  listFoodLogByDay,
  sumFoodLogForDay,
} from './patients';


const KEY = randomBytes(32);
const BR = -180; // offset do fuso em minutos (local = UTC + offset)

async function insertUser(exec: SqlExecutor, email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Dra. Demo', 'x'],
  );
  return res.rows[0]!.id;
}

describe('Nutrition Goals & Food Log (E12 — 12.2)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'nutri@nutrimed.test');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Metas — cifradas, auditadas e versionadas (NFR9/NFR10)', () => {
    it('grava meta cifrada (ilegível no storage), lê a vigente e audita', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Meta Base' }, KEY);
      await setNutritionGoal(
        exec,
        patientId,
        userId,
        '2026-01-01',
        { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
        KEY,
      );

      const raw = await exec.query<{ values_enc: string }>(
        'SELECT values_enc FROM nutrition_goal WHERE patient_id = $1 LIMIT 1',
        [patientId],
      );
      expect(raw.rows[0]!.values_enc).not.toContain('2000');
      expect(raw.rows[0]!.values_enc).not.toContain('protein');

      const goal = await loadCurrentNutritionGoal(exec, patientId, KEY, '2026-02-01');
      expect(goal!.values).toEqual({ kcal: 2000, protein: 150, carbs: 200, fat: 60 });
      expect(goal!.effectiveFrom).toBe('2026-01-01');

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'nutrition-goal-set')).toBe(true);
    });

    it('versiona: a meta vigente é a de maior effective_from <= a data consultada', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Meta Versão' }, KEY);
      await setNutritionGoal(exec, patientId, userId, '2026-01-01', { kcal: 2200, protein: 160, carbs: 220, fat: 70 }, KEY);
      await setNutritionGoal(exec, patientId, userId, '2026-06-01', { kcal: 1800, protein: 150, carbs: 160, fat: 55 }, KEY);

      const emMarco = await loadCurrentNutritionGoal(exec, patientId, KEY, '2026-03-15');
      const emJulho = await loadCurrentNutritionGoal(exec, patientId, KEY, '2026-07-01');
      expect(emMarco!.values.kcal).toBe(2200);
      expect(emJulho!.values.kcal).toBe(1800);

      const historico = await listNutritionGoalHistory(exec, patientId, KEY);
      expect(historico.map((g) => g.effectiveFrom)).toEqual(['2026-06-01', '2026-01-01']);
    });

    it('antes da primeira vigência ⇒ sem meta (null)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Meta Futura' }, KEY);
      await setNutritionGoal(exec, patientId, userId, '2026-06-01', { kcal: 1800, protein: 150, carbs: 160, fat: 55 }, KEY);
      expect(await loadCurrentNutritionGoal(exec, patientId, KEY, '2026-01-01')).toBeNull();
    });
  });

  describe('Food log — cifrado, auditado com proveniência do estimador (NFR9/NFR10)', () => {
    it('registra a foto cifrada (ilegível), lista no dia e audita a origem/modelo', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Consumo' }, KEY);
      await addFoodLogEntry(
        exec,
        patientId,
        {
          eatenAt: new Date('2026-07-01T12:00:00Z'),
          values: { kcal: 650, protein: 40, carbs: 70, fat: 20, confidence: 'medium', itemsLabel: 'arroz, frango, salada' },
          photoRef: 'tg-file-123',
          modelVersion: 'food-vision-fake',
        },
        KEY,
        { action: 'telegram-bot', modelVersion: 'food-vision-fake' },
      );

      const raw = await exec.query<{ values_enc: string }>(
        'SELECT values_enc FROM food_log_entry WHERE patient_id = $1 LIMIT 1',
        [patientId],
      );
      expect(raw.rows[0]!.values_enc).not.toContain('650');
      expect(raw.rows[0]!.values_enc).not.toContain('frango');

      const doDia = await listFoodLogByDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(doDia).toHaveLength(1);
      expect(doDia[0]!.values.kcal).toBe(650);
      expect(doDia[0]!.values.itemsLabel).toBe('arroz, frango, salada');
      expect(doDia[0]!.photoRef).toBe('tg-file-123');

      const trail = await getAuditTrail(exec, patientId);
      expect(
        trail.some((e) => e.triggeredBy === 'telegram-bot' && e.modelVersion === 'food-vision-fake'),
      ).toBe(true);
    });

    it('janela por timezone BR: agrupa pelo dia LOCAL, não pelo UTC', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Fuso' }, KEY);
      // 02:00Z de 01/jul = 23:00 de 30/jun no BR (UTC-3) ⇒ pertence a 30/jun.
      await addFoodLogEntry(exec, patientId, { eatenAt: new Date('2026-07-01T02:00:00Z'), values: { kcal: 300, protein: 10, carbs: 40, fat: 8 } }, KEY);
      // 12:00Z de 01/jul = 09:00 de 01/jul no BR ⇒ pertence a 01/jul.
      await addFoodLogEntry(exec, patientId, { eatenAt: new Date('2026-07-01T12:00:00Z'), values: { kcal: 500, protein: 30, carbs: 50, fat: 15 } }, KEY);

      const dia30 = await listFoodLogByDay(exec, patientId, '2026-06-30', BR, KEY);
      const dia01 = await listFoodLogByDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(dia30.map((e) => e.values.kcal)).toEqual([300]);
      expect(dia01.map((e) => e.values.kcal)).toEqual([500]);
    });

    it('corrige a última entrada (update, não insert) e audita a correção', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Correção' }, KEY);
      await addFoodLogEntry(exec, patientId, { eatenAt: new Date('2026-07-01T12:00:00Z'), values: { kcal: 400, protein: 20, carbs: 50, fat: 10 } }, KEY);
      await addFoodLogEntry(
        exec,
        patientId,
        { eatenAt: new Date('2026-07-01T18:00:00Z'), values: { kcal: 700, protein: 30, carbs: 80, fat: 25, itemsLabel: 'peixe assado' }, photoRef: 'tg-x' },
        KEY,
      );

      const latest = await findLatestFoodLogEntry(exec, patientId, KEY);
      expect(latest!.values.itemsLabel).toBe('peixe assado');
      expect(latest!.photoRef).toBe('tg-x');

      const ok = await updateFoodLogEntryValues(
        exec,
        patientId,
        latest!.id,
        { kcal: 620, protein: 45, carbs: 60, fat: 18, itemsLabel: 'frango grelhado' },
        KEY,
        'food-vision-fake',
        { action: 'telegram-bot-correct', modelVersion: 'food-vision-fake' },
      );
      expect(ok).toBe(true);

      const doDia = await listFoodLogByDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(doDia).toHaveLength(2); // atualizou — não inseriu uma terceira
      expect(doDia[1]!.values.itemsLabel).toBe('frango grelhado');
      expect(doDia[1]!.values.kcal).toBe(620);
      expect(doDia[0]!.values.kcal).toBe(400); // a entrada anterior segue intacta

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'telegram-bot-correct')).toBe(true);
    });

    it('corrigir entrada de outro paciente ⇒ false (nada muda, nada audita)', async () => {
      const donoId = await createPatient(exec, userId, { name: 'Dono' }, KEY);
      const outroId = await createPatient(exec, userId, { name: 'Outro' }, KEY);
      await addFoodLogEntry(exec, donoId, { eatenAt: new Date('2026-07-01T12:00:00Z'), values: { kcal: 500, protein: 30, carbs: 50, fat: 15 } }, KEY);
      const entry = await findLatestFoodLogEntry(exec, donoId, KEY);

      const ok = await updateFoodLogEntryValues(exec, outroId, entry!.id, { kcal: 1, protein: 1, carbs: 1, fat: 1 }, KEY);
      expect(ok).toBe(false);

      const intacta = await findLatestFoodLogEntry(exec, donoId, KEY);
      expect(intacta!.values.kcal).toBe(500);
    });
  });

  describe('sumFoodLogForDay — progresso vs. meta', () => {
    it('soma o consumo do dia e calcula o restante frente à meta vigente', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Progresso' }, KEY);
      await setNutritionGoal(exec, patientId, userId, '2026-07-01', { kcal: 2000, protein: 150, carbs: 200, fat: 60 }, KEY);
      await addFoodLogEntry(exec, patientId, { eatenAt: new Date('2026-07-01T13:00:00Z'), values: { kcal: 600, protein: 40, carbs: 60, fat: 18 } }, KEY);
      await addFoodLogEntry(exec, patientId, { eatenAt: new Date('2026-07-01T21:00:00Z'), values: { kcal: 700, protein: 50, carbs: 70, fat: 22 } }, KEY);

      const p = await sumFoodLogForDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(p.consumed).toEqual({ kcal: 1300, protein: 90, carbs: 130, fat: 40 });
      expect(p.goal).toEqual({ kcal: 2000, protein: 150, carbs: 200, fat: 60 });
      expect(p.remaining).toEqual({ kcal: 700, protein: 60, carbs: 70, fat: 20 });
    });

    it('sem meta definida ⇒ consumo somado, mas goal/remaining null (não inventa — ADR-015)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sem Meta' }, KEY);
      await addFoodLogEntry(exec, patientId, { eatenAt: new Date('2026-07-01T13:00:00Z'), values: { kcal: 450, protein: 25, carbs: 55, fat: 12 } }, KEY);

      const p = await sumFoodLogForDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(p.consumed.kcal).toBe(450);
      expect(p.goal).toBeNull();
      expect(p.remaining).toBeNull();
    });

    it('dia sem registro ⇒ consumo zerado', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Dia Vazio' }, KEY);
      const p = await sumFoodLogForDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(p.consumed).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
    });
  });
});
