import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor, pgliteExecutor } from '@nutrimed/db';
import { getAuditTrail } from '@nutrimed/audit';
import {
  createPatient,
  setNutritionGoal,
  addWaterLog,
  listWaterLogByDay,
  sumWaterForDay,
  addSleepEvent,
  findLastSleepSession,
  classifySleepDuration,
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

describe('Água + sono via Telegram (pedido do médico, 2026-07-20)', () => {
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

  describe('Água — cifrada, auditada, somada por dia local', () => {
    it('registra cifrado (ilegível no storage), lista no dia e audita', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Água Base' }, KEY);
      await addWaterLog(exec, patientId, 500, new Date('2026-07-01T13:00:00Z'), KEY);

      const raw = await exec.query<{ values_enc: string }>(
        "SELECT values_enc FROM patient_self_log WHERE patient_id = $1 AND kind = 'water' LIMIT 1",
        [patientId],
      );
      expect(raw.rows[0]!.values_enc).not.toContain('500');

      const doDia = await listWaterLogByDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(doDia).toHaveLength(1);
      expect(doDia[0]!.ml).toBe(500);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'water-log-add')).toBe(true);
    });

    it('janela por timezone BR: agrupa pelo dia LOCAL, não pelo UTC', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Água Fuso' }, KEY);
      // 02:00Z de 01/jul = 23:00 de 30/jun no BR ⇒ pertence a 30/jun.
      await addWaterLog(exec, patientId, 300, new Date('2026-07-01T02:00:00Z'), KEY);
      // 12:00Z de 01/jul = 09:00 de 01/jul no BR ⇒ pertence a 01/jul.
      await addWaterLog(exec, patientId, 200, new Date('2026-07-01T12:00:00Z'), KEY);

      expect((await listWaterLogByDay(exec, patientId, '2026-06-30', BR, KEY)).map((e) => e.ml)).toEqual([300]);
      expect((await listWaterLogByDay(exec, patientId, '2026-07-01', BR, KEY)).map((e) => e.ml)).toEqual([200]);
    });

    it('sumWaterForDay soma o consumido e compara com waterMl da meta vigente', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Água Progresso' }, KEY);
      await setNutritionGoal(
        exec,
        patientId,
        userId,
        '2026-07-01',
        { kcal: 2000, protein: 150, carbs: 200, fat: 60, waterMl: 2000 },
        KEY,
      );
      await addWaterLog(exec, patientId, 500, new Date('2026-07-01T13:00:00Z'), KEY);
      await addWaterLog(exec, patientId, 300, new Date('2026-07-01T18:00:00Z'), KEY);

      const p = await sumWaterForDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(p.consumedMl).toBe(800);
      expect(p.goalMl).toBe(2000);
      expect(p.remainingMl).toBe(1200);
    });

    it('meta antiga sem waterMl (ou sem meta nenhuma) ⇒ goalMl/remainingMl null, sem quebrar', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Água Sem Meta Água' }, KEY);
      await setNutritionGoal(exec, patientId, userId, '2026-07-01', { kcal: 2000, protein: 150, carbs: 200, fat: 60 }, KEY);
      await addWaterLog(exec, patientId, 400, new Date('2026-07-01T13:00:00Z'), KEY);

      const p = await sumWaterForDay(exec, patientId, '2026-07-01', BR, KEY);
      expect(p.consumedMl).toBe(400);
      expect(p.goalMl).toBeNull();
      expect(p.remainingMl).toBeNull();

      const semNenhumaMeta = await createPatient(exec, userId, { name: 'Água Zero Meta' }, KEY);
      const p2 = await sumWaterForDay(exec, semNenhumaMeta, '2026-07-01', BR, KEY);
      expect(p2).toEqual({ day: '2026-07-01', consumedMl: 0, goalMl: null, remainingMl: null });
    });
  });

  describe('classifySleepDuration — faixas puras', () => {
    it('classifica curta/boa/longa pelas fronteiras de minutos', () => {
      expect(classifySleepDuration(300)).toBe('curta'); // 5h
      expect(classifySleepDuration(359)).toBe('curta');
      expect(classifySleepDuration(360)).toBe('boa'); // 6h
      expect(classifySleepDuration(480)).toBe('boa'); // 8h
      expect(classifySleepDuration(570)).toBe('boa'); // 9h30 — limite inclusivo
      expect(classifySleepDuration(571)).toBe('longa');
      expect(classifySleepDuration(700)).toBe('longa');
    });
  });

  describe('findLastSleepSession — pareia deitar→acordar', () => {
    it('pareia o último sleep_end com o sleep_start mais recente antes dele', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sono Base' }, KEY);
      await addSleepEvent(exec, patientId, 'sleep_start', new Date('2026-07-01T02:30:00Z'), KEY); // 23:30 BR
      await addSleepEvent(exec, patientId, 'sleep_end', new Date('2026-07-01T10:00:00Z'), KEY); // 07:00 BR

      const session = await findLastSleepSession(exec, patientId, KEY);
      expect(session).not.toBeNull();
      expect(session!.durationMinutes).toBeCloseTo(450, 5); // 7h30
      expect(session!.quality).toBe('boa');

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'sleep-log-add')).toBe(true);
    });

    it('sem sleep_end algum ⇒ null', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sono Sem Fim' }, KEY);
      await addSleepEvent(exec, patientId, 'sleep_start', new Date('2026-07-01T02:30:00Z'), KEY);
      expect(await findLastSleepSession(exec, patientId, KEY)).toBeNull();
    });

    it('sleep_end sem NENHUM sleep_start anterior ⇒ null (evento fica salvo, sem virar sessão)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sono Só Fim' }, KEY);
      await addSleepEvent(exec, patientId, 'sleep_end', new Date('2026-07-01T10:00:00Z'), KEY);
      expect(await findLastSleepSession(exec, patientId, KEY)).toBeNull();
    });

    it('sleep_start MUITO antes do sleep_end (> 16h) não pareia — evita noite implausível', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sono Implausível' }, KEY);
      await addSleepEvent(exec, patientId, 'sleep_start', new Date('2026-06-28T02:00:00Z'), KEY); // 3 dias antes
      await addSleepEvent(exec, patientId, 'sleep_end', new Date('2026-07-01T10:00:00Z'), KEY);
      expect(await findLastSleepSession(exec, patientId, KEY)).toBeNull();
    });

    it('usa sempre o par mais recente (várias noites registradas)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sono Várias Noites' }, KEY);
      await addSleepEvent(exec, patientId, 'sleep_start', new Date('2026-06-30T02:00:00Z'), KEY);
      await addSleepEvent(exec, patientId, 'sleep_end', new Date('2026-06-30T09:00:00Z'), KEY); // noite 1: 7h
      await addSleepEvent(exec, patientId, 'sleep_start', new Date('2026-07-01T03:00:00Z'), KEY);
      await addSleepEvent(exec, patientId, 'sleep_end', new Date('2026-07-01T08:00:00Z'), KEY); // noite 2: 5h

      const session = await findLastSleepSession(exec, patientId, KEY);
      expect(session!.durationMinutes).toBeCloseTo(300, 5); // 5h — a noite mais recente
      expect(session!.quality).toBe('curta');
    });
  });
});
