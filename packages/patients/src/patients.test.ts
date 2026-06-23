import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { getAuditTrail } from '@nutrimed/audit';
import {
  computeAge,
  createPatient,
  updatePatient,
  loadPatient,
  listPatients,
  addBodyComposition,
  listBodyComposition,
  addLabExam,
  listLabExam,
} from './patients';

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

async function insertUser(exec: SqlExecutor, email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Dra. Demo', 'x'],
  );
  return res.rows[0]!.id;
}

describe('Patient Service (E11 — 11.2)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'medico@nutrimed.test');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('CRUD de paciente — cifrado e auditado (NFR9/NFR10)', () => {
    it('cria cifrado (ilegível no storage), carrega decifrado e audita patient-create', async () => {
      const patientId = await createPatient(
        exec,
        userId,
        { name: 'Carla Mendes', phone: '+5511999990000', birthDate: '1990-02-15', goal: 'Perder 8kg' },
        KEY,
      );

      const raw = await exec.query<{ name_enc: string; phone_enc: string }>(
        'SELECT name_enc, phone_enc FROM patient WHERE id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.name_enc).not.toContain('Carla');
      expect(raw.rows[0]!.phone_enc).not.toContain('5511');

      const patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.name).toBe('Carla Mendes');
      expect(patient!.phone).toBe('+5511999990000');
      expect(patient!.birthDate).toBe('1990-02-15');
      expect(patient!.goal).toBe('Perder 8kg');

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'patient-create' && e.modelVersion === 'human-edit')).toBe(true);
    });

    it('atualiza os dados e audita patient-edit', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Nome Antigo' }, KEY);
      await updatePatient(exec, patientId, { name: 'Nome Novo', goal: 'Manter peso' }, KEY);

      const patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.name).toBe('Nome Novo');
      expect(patient!.goal).toBe('Manter peso');

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'patient-edit')).toBe(true);
    });

    it('campos opcionais ausentes ⇒ null (sem placeholder cifrado)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Só Nome' }, KEY);
      const raw = await exec.query<{ phone_enc: string | null; goal_enc: string | null }>(
        'SELECT phone_enc, goal_enc FROM patient WHERE id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.phone_enc).toBeNull();
      expect(raw.rows[0]!.goal_enc).toBeNull();

      const patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.phone).toBeNull();
      expect(patient!.goal).toBeNull();
    });

    it('paciente inexistente ⇒ null', async () => {
      expect(await loadPatient(exec, '00000000-0000-0000-0000-000000000000', KEY)).toBeNull();
    });
  });

  describe('Escopo por médico (FR23 — sem vazamento entre médicos)', () => {
    it('listPatients retorna só os pacientes do dono', async () => {
      const drA = await insertUser(exec, 'dra@nutrimed.test');
      const drB = await insertUser(exec, 'drb@nutrimed.test');
      await createPatient(exec, drA, { name: 'Paciente de A' }, KEY);
      await createPatient(exec, drB, { name: 'Paciente de B' }, KEY);

      const listA = await listPatients(exec, drA, KEY);
      const listB = await listPatients(exec, drB, KEY);
      expect(listA.map((p) => p.name)).toContain('Paciente de A');
      expect(listA.map((p) => p.name)).not.toContain('Paciente de B');
      expect(listB.map((p) => p.name)).toContain('Paciente de B');
    });
  });

  describe('Medições — blob JSON cifrado, ordenado por data (FR25 / ADR-011)', () => {
    it('grava composição corporal cifrada, lista em ordem cronológica e audita', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Evolução BIA' }, KEY);
      await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-03-01'), values: { peso: 90, massaGordura: 30 } },
        KEY,
      );
      await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-01-01'), values: { peso: 95, massaGordura: 33 } },
        KEY,
      );

      const raw = await exec.query<{ values_enc: string }>(
        'SELECT values_enc FROM body_composition WHERE patient_id = $1 LIMIT 1',
        [patientId],
      );
      expect(raw.rows[0]!.values_enc).not.toContain('90');
      expect(raw.rows[0]!.values_enc).not.toContain('peso');

      const evo = await listBodyComposition(exec, patientId, KEY);
      expect(evo.map((m) => m.values.peso)).toEqual([95, 90]); // cronológico: jan, mar
      expect(evo[0]!.values.massaGordura).toBe(33);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.filter((e) => e.triggeredBy === 'measurement-add').length).toBe(2);
    });

    it('aceita medição parcial de exame (só um marcador)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Evolução Lab' }, KEY);
      await addLabExam(exec, patientId, { measuredAt: new Date('2026-02-01'), values: { hba1c: 6.2 } }, KEY);

      const evo = await listLabExam(exec, patientId, KEY);
      expect(evo).toHaveLength(1);
      expect(evo[0]!.values.hba1c).toBe(6.2);
      expect(evo[0]!.values.ldl).toBeUndefined();
    });

    it('vincula a consulta de origem quando informada', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Com Origem' }, KEY);
      const c = await exec.query<{ id: string }>(
        'INSERT INTO consultation (user_id, patient_label_enc, patient_id) VALUES ($1, $2, $3) RETURNING id',
        [userId, 'x', patientId],
      );
      const consultationId = c.rows[0]!.id;
      await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-04-01'), values: { peso: 80 }, sourceConsultationId: consultationId },
        KEY,
      );
      const evo = await listBodyComposition(exec, patientId, KEY);
      expect(evo[0]!.sourceConsultationId).toBe(consultationId);
    });
  });

  describe('computeAge — idade derivada (não persistida)', () => {
    it('calcula anos completos relativos a uma data de referência', () => {
      expect(computeAge('1990-02-15', new Date('2026-06-23'))).toBe(36);
      expect(computeAge('1990-12-31', new Date('2026-06-23'))).toBe(35); // ainda não fez aniversário
    });
    it('retorna null para data ausente ou inválida', () => {
      expect(computeAge(null, new Date('2026-06-23'))).toBeNull();
      expect(computeAge('não-é-data', new Date('2026-06-23'))).toBeNull();
    });
  });
});
