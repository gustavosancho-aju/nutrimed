import type { SqlExecutor } from '@nutrimed/db';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { writeAudit } from '@nutrimed/audit';

/**
 * Patient Service (E11 — FR22/FR25). O paciente é entidade de primeira classe
 * (dono = médico). PII e dados de saúde são cifrados em repouso (NFR9) e toda
 * escrita gera trilha de auditoria (NFR10) — mesmo padrão de @nutrimed/clinical-notes.
 *
 * Decisões:
 * - Idade NÃO é persistida — derivada de `birthDate` por {@link computeAge}.
 * - Medições (composição corporal / exames) guardam os valores num blob JSON
 *   cifrado (`values_enc`), decifrado no servidor ao montar a dashboard (ADR-011).
 *   Campos são opcionais: uma medição parcial (só peso, por ex.) é válida.
 * - A referência de origem da auditoria é o `patientId` (writeAudit aceita
 *   qualquer string como contributionId) — sem alterar o contrato de @nutrimed/audit.
 */

/** Origem de uma escrita, para a trilha (NFR10). Manual ⇒ 'human-edit'. */
export interface WriteOrigin {
  readonly action: string;
  readonly modelVersion?: string;
}

export interface PatientInput {
  readonly name: string;
  readonly phone?: string;
  /** Data de nascimento em ISO `YYYY-MM-DD`. Idade é derivada, nunca persistida. */
  readonly birthDate?: string;
  readonly goal?: string;
}

export interface Patient {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly birthDate: string | null;
  readonly goal: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BodyCompositionValues {
  readonly peso?: number;
  readonly massaMuscular?: number;
  readonly massaGordura?: number;
  readonly cintura?: number;
  readonly imc?: number;
  readonly pgc?: number;
}

export interface LabExamValues {
  readonly ldl?: number;
  readonly hba1c?: number;
  readonly insulina?: number;
}

export interface Measurement<T> {
  readonly id: string;
  readonly patientId: string;
  readonly measuredAt: Date;
  readonly sourceConsultationId: string | null;
  readonly values: T;
  readonly createdAt: Date;
}

export interface MeasurementInput<T> {
  readonly measuredAt: Date;
  readonly values: T;
  readonly sourceConsultationId?: string;
}

/** Cifra um campo opcional; ausente/vazio ⇒ null (não grava placeholder cifrado). */
function encOptional(value: string | undefined, key: Buffer): string | null {
  if (value === undefined || value === '') return null;
  return encryptField(value, key);
}

function decOptional(value: string | null, key: Buffer): string | null {
  return value === null ? null : decryptField(value, key);
}

/**
 * Idade em anos completos a partir da data de nascimento ISO (`YYYY-MM-DD`).
 * Recebe `now` explicitamente (testável; sem relógio implícito). Retorna null
 * se a data for ausente ou inválida.
 */
export function computeAge(birthDate: string | null | undefined, now: Date): number | null {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age < 0 ? null : age;
}

/** Cria um paciente (PII cifrada) e audita a criação (NFR9/NFR10). */
export async function createPatient(
  db: SqlExecutor,
  userId: string,
  input: PatientInput,
  key: Buffer,
  origin: WriteOrigin = { action: 'patient-create' },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO patient (user_id, name_enc, phone_enc, birth_date_enc, goal_enc)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      userId,
      encryptField(input.name, key),
      encOptional(input.phone, key),
      encOptional(input.birthDate, key),
      encOptional(input.goal, key),
    ],
  );
  const patientId = res.rows[0]!.id;
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
  return patientId;
}

/** Atualiza os dados do paciente (cifrados) e audita a edição. */
export async function updatePatient(
  db: SqlExecutor,
  patientId: string,
  input: PatientInput,
  key: Buffer,
  origin: WriteOrigin = { action: 'patient-edit' },
): Promise<void> {
  await db.query(
    `UPDATE patient
     SET name_enc = $2, phone_enc = $3, birth_date_enc = $4, goal_enc = $5, updated_at = now()
     WHERE id = $1`,
    [
      patientId,
      encryptField(input.name, key),
      encOptional(input.phone, key),
      encOptional(input.birthDate, key),
      encOptional(input.goal, key),
    ],
  );
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
}

interface PatientRow {
  id: string;
  user_id: string;
  name_enc: string;
  phone_enc: string | null;
  birth_date_enc: string | null;
  goal_enc: string | null;
  created_at: Date;
  updated_at: Date;
}

function toPatient(row: PatientRow, key: Buffer): Patient {
  return {
    id: row.id,
    userId: row.user_id,
    name: decryptField(row.name_enc, key),
    phone: decOptional(row.phone_enc, key),
    birthDate: decOptional(row.birth_date_enc, key),
    goal: decOptional(row.goal_enc, key),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Carrega e decifra um paciente (null se não existe). */
export async function loadPatient(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
): Promise<Patient | null> {
  const res = await db.query<PatientRow>('SELECT * FROM patient WHERE id = $1', [patientId]);
  const row = res.rows[0];
  return row ? toPatient(row, key) : null;
}

/**
 * Lista os pacientes do médico dono (escopo por user_id — nunca vaza paciente
 * de outro médico). Ordenado por criação mais recente.
 */
export async function listPatients(
  db: SqlExecutor,
  userId: string,
  key: Buffer,
): Promise<Patient[]> {
  const res = await db.query<PatientRow>(
    'SELECT * FROM patient WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
    [userId],
  );
  return res.rows.map((r) => toPatient(r, key));
}

interface MeasurementRow {
  id: string;
  patient_id: string;
  measured_at: Date;
  source_consultation_id: string | null;
  values_enc: string;
  created_at: Date;
}

function toMeasurement<T>(row: MeasurementRow, key: Buffer): Measurement<T> {
  return {
    id: row.id,
    patientId: row.patient_id,
    measuredAt: new Date(row.measured_at),
    sourceConsultationId: row.source_consultation_id,
    values: JSON.parse(decryptField(row.values_enc, key)) as T,
    createdAt: new Date(row.created_at),
  };
}

async function addMeasurement<T>(
  db: SqlExecutor,
  table: 'body_composition' | 'lab_exam',
  patientId: string,
  input: MeasurementInput<T>,
  key: Buffer,
  origin: WriteOrigin,
): Promise<string> {
  const valuesEnc = encryptField(JSON.stringify(input.values), key);
  const res = await db.query<{ id: string }>(
    `INSERT INTO ${table} (patient_id, measured_at, source_consultation_id, values_enc)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [patientId, input.measuredAt, input.sourceConsultationId ?? null, valuesEnc],
  );
  const measurementId = res.rows[0]!.id;
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
  return measurementId;
}

async function listMeasurements<T>(
  db: SqlExecutor,
  table: 'body_composition' | 'lab_exam',
  patientId: string,
  key: Buffer,
): Promise<Measurement<T>[]> {
  // Ordenado por data de medição ASC — evolução cronológica para os gráficos.
  const res = await db.query<MeasurementRow>(
    `SELECT * FROM ${table} WHERE patient_id = $1 ORDER BY measured_at ASC, id ASC`,
    [patientId],
  );
  return res.rows.map((r) => toMeasurement<T>(r, key));
}

/** Adiciona uma medição de composição corporal (blob cifrado + auditada). */
export function addBodyComposition(
  db: SqlExecutor,
  patientId: string,
  input: MeasurementInput<BodyCompositionValues>,
  key: Buffer,
  origin: WriteOrigin = { action: 'measurement-add' },
): Promise<string> {
  return addMeasurement(db, 'body_composition', patientId, input, key, origin);
}

/** Adiciona uma medição de exames laboratoriais (blob cifrado + auditada). */
export function addLabExam(
  db: SqlExecutor,
  patientId: string,
  input: MeasurementInput<LabExamValues>,
  key: Buffer,
  origin: WriteOrigin = { action: 'measurement-add' },
): Promise<string> {
  return addMeasurement(db, 'lab_exam', patientId, input, key, origin);
}

/** Evolução de composição corporal do paciente (ordem cronológica). */
export function listBodyComposition(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
): Promise<Measurement<BodyCompositionValues>[]> {
  return listMeasurements<BodyCompositionValues>(db, 'body_composition', patientId, key);
}

/** Evolução de exames laboratoriais do paciente (ordem cronológica). */
export function listLabExam(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
): Promise<Measurement<LabExamValues>[]> {
  return listMeasurements<LabExamValues>(db, 'lab_exam', patientId, key);
}
