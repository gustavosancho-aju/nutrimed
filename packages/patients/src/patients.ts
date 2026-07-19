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
  readonly profession?: string;
}

export interface Patient {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly birthDate: string | null;
  readonly goal: string | null;
  readonly profession: string | null;
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
  /**
   * Exames personalizados do paciente (slots 1–3). A chave é o SLOT (estável),
   * não o nome: renomear um exame na configuração não migra dados — o histórico
   * do slot é re-rotulado. Definições em {@link CustomExamDef}.
   */
  readonly custom1?: number;
  readonly custom2?: number;
  readonly custom3?: number;
}

/**
 * Definição de um exame personalizado do paciente (nome/unidade escolhidos pelo
 * médico — ex.: TSH, Vitamina D). Guardada cifrada em patient.custom_exams_enc;
 * os valores históricos ficam em lab_exam.values_enc sob a chave `custom{slot}`.
 */
export interface CustomExamDef {
  readonly slot: 1 | 2 | 3;
  readonly name: string;
  readonly unit?: string;
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
    `INSERT INTO patient (user_id, name_enc, phone_enc, birth_date_enc, goal_enc, profession_enc)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      userId,
      encryptField(input.name, key),
      encOptional(input.phone, key),
      encOptional(input.birthDate, key),
      encOptional(input.goal, key),
      encOptional(input.profession, key),
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
     SET name_enc = $2, phone_enc = $3, birth_date_enc = $4, goal_enc = $5,
         profession_enc = $6, updated_at = now()
     WHERE id = $1`,
    [
      patientId,
      encryptField(input.name, key),
      encOptional(input.phone, key),
      encOptional(input.birthDate, key),
      encOptional(input.goal, key),
      encOptional(input.profession, key),
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
  profession_enc: string | null;
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
    profession: decOptional(row.profession_enc, key),
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
 * de outro médico). Ordem padrão: alfabética pelo nome. Como o nome é cifrado
 * (NFR9), o ORDER BY não pode acontecer no SQL: carregamos o escopo do médico,
 * deciframos e ordenamos em memória — a paginação (limit/offset) é aplicada
 * depois da ordenação. `orderBy: 'recent'` mantém o comportamento antigo.
 */
export async function listPatients(
  db: SqlExecutor,
  userId: string,
  key: Buffer,
  opts?: { limit?: number; offset?: number; orderBy?: 'name' | 'recent' },
): Promise<Patient[]> {
  const orderBy = opts?.orderBy ?? 'name';
  const res = await db.query<PatientRow>(
    'SELECT * FROM patient WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
    [userId],
  );
  let patients = res.rows.map((r) => toPatient(r, key));
  if (orderBy === 'name') {
    patients = patients
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }
  if (opts?.limit !== undefined) {
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const limit = Math.max(1, Math.floor(opts.limit));
    patients = patients.slice(offset, offset + limit);
  }
  return patients;
}

/** Total de pacientes do médico (para paginação da lista). */
export async function countPatients(db: SqlExecutor, userId: string): Promise<number> {
  const res = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM patient WHERE user_id = $1',
    [userId],
  );
  return res.rows[0]?.n ?? 0;
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

/** Teto de medições carregadas por paciente (bound de memória/decifragem). */
const MAX_MEASUREMENTS = 2000;

async function listMeasurements<T>(
  db: SqlExecutor,
  table: 'body_composition' | 'lab_exam',
  patientId: string,
  key: Buffer,
): Promise<Measurement<T>[]> {
  // Teto de segurança: busca as MAIS RECENTES (DESC) e reordena para ASC — um
  // paciente real nunca chega perto de 2000 medições, mas isso evita carregar e
  // decifrar um histórico ilimitado em memória. Desempate por created_at:
  // medições do MESMO dia (measured_at idêntico, hora zerada) saem na ordem de
  // inserção — id (UUID aleatório) sozinho embaralharia os pontos do gráfico.
  const res = await db.query<MeasurementRow>(
    `SELECT * FROM ${table} WHERE patient_id = $1 AND deleted_at IS NULL
     ORDER BY measured_at DESC, created_at DESC, id DESC
     LIMIT ${MAX_MEASUREMENTS}`,
    [patientId],
  );
  return res.rows.reverse().map((r) => toMeasurement<T>(r, key));
}

/**
 * Atualiza uma medição existente (recifra o blob) — feedback do piloto: corrigir
 * dado digitado errado. O WHERE amarra id + patient_id (posse) + não-excluída;
 * 0 linhas afetadas ⇒ erro (medição de outro paciente nunca é tocada).
 */
async function updateMeasurement<T>(
  db: SqlExecutor,
  table: 'body_composition' | 'lab_exam',
  patientId: string,
  measurementId: string,
  input: MeasurementInput<T>,
  key: Buffer,
  origin: WriteOrigin,
): Promise<void> {
  const valuesEnc = encryptField(JSON.stringify(input.values), key);
  // RETURNING id: o contrato SqlExecutor não expõe rowCount — 0 linhas ⇒ erro
  const res = await db.query<{ id: string }>(
    `UPDATE ${table} SET values_enc = $3, measured_at = $4
     WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL RETURNING id`,
    [measurementId, patientId, valuesEnc, input.measuredAt],
  );
  if (res.rows.length === 0) throw new Error('Medição não encontrada para este paciente.');
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
}

/**
 * SOFT-delete de uma medição: a linha permanece (trilha/retensão — CJ-2 sem
 * parecer), mas some das listagens, gráficos e do relatório nutricional.
 */
async function softDeleteMeasurement(
  db: SqlExecutor,
  table: 'body_composition' | 'lab_exam',
  patientId: string,
  measurementId: string,
  origin: WriteOrigin,
): Promise<void> {
  const res = await db.query<{ id: string }>(
    `UPDATE ${table} SET deleted_at = now()
     WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL RETURNING id`,
    [measurementId, patientId],
  );
  if (res.rows.length === 0) throw new Error('Medição não encontrada para este paciente.');
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
}

/** Edita uma medição de composição corporal (recifra + audita). */
export function updateBodyComposition(
  db: SqlExecutor,
  patientId: string,
  measurementId: string,
  input: MeasurementInput<BodyCompositionValues>,
  key: Buffer,
  origin: WriteOrigin = { action: 'measurement-edit' },
): Promise<void> {
  return updateMeasurement(db, 'body_composition', patientId, measurementId, input, key, origin);
}

/** Edita uma medição de exames laboratoriais (recifra + audita). */
export function updateLabExam(
  db: SqlExecutor,
  patientId: string,
  measurementId: string,
  input: MeasurementInput<LabExamValues>,
  key: Buffer,
  origin: WriteOrigin = { action: 'measurement-edit' },
): Promise<void> {
  return updateMeasurement(db, 'lab_exam', patientId, measurementId, input, key, origin);
}

/** Exclui (soft) uma medição de composição corporal (audita a exclusão). */
export function softDeleteBodyComposition(
  db: SqlExecutor,
  patientId: string,
  measurementId: string,
  origin: WriteOrigin = { action: 'measurement-delete' },
): Promise<void> {
  return softDeleteMeasurement(db, 'body_composition', patientId, measurementId, origin);
}

/** Exclui (soft) uma medição de exames laboratoriais (audita a exclusão). */
export function softDeleteLabExam(
  db: SqlExecutor,
  patientId: string,
  measurementId: string,
  origin: WriteOrigin = { action: 'measurement-delete' },
): Promise<void> {
  return softDeleteMeasurement(db, 'lab_exam', patientId, measurementId, origin);
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

// ─────────────────────────────────────────────────────────────────────────────
// Exames personalizados por paciente (até 3 slots) — configuração 1:1 cifrada
// na coluna patient.custom_exams_enc (nome de exame revela condição de saúde,
// NFR9). Sem versionamento: a auditoria 'custom-exams-set' registra as edições.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Salva as definições dos exames personalizados do paciente (substitui o
 * conjunto; lista vazia ⇒ limpa a coluna). Cifrado + auditado.
 */
export async function setCustomExamDefs(
  db: SqlExecutor,
  patientId: string,
  defs: readonly CustomExamDef[],
  key: Buffer,
  origin: WriteOrigin = { action: 'custom-exams-set' },
): Promise<void> {
  const enc = defs.length > 0 ? encryptField(JSON.stringify(defs), key) : null;
  await db.query(
    `UPDATE patient SET custom_exams_enc = $2, updated_at = now() WHERE id = $1`,
    [patientId, enc],
  );
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
}

/** Definições dos exames personalizados do paciente (coluna vazia ⇒ []). */
export async function loadCustomExamDefs(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
): Promise<CustomExamDef[]> {
  const res = await db.query<{ custom_exams_enc: string | null }>(
    'SELECT custom_exams_enc FROM patient WHERE id = $1',
    [patientId],
  );
  const enc = res.rows[0]?.custom_exams_enc ?? null;
  if (enc === null) return [];
  return JSON.parse(decryptField(enc, key)) as CustomExamDef[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Metas corporais do paciente — definidas pelo médico e VERSIONADAS por append
// (mesmo padrão de nutrition_goal: a vigente é a de maior effective_from <= o
// dia consultado; sem UPDATE destrutivo). Todos os campos opcionais — meta
// parcial (só peso, por ex.) é válida. Cifrado (NFR9) + auditado (NFR10).
// ─────────────────────────────────────────────────────────────────────────────

/** Metas corporais alvo (campos opcionais — meta parcial é válida). */
export interface BodyGoalValues {
  readonly peso?: number;
  readonly imc?: number;
  readonly massaMuscular?: number;
  readonly massaGordura?: number;
  readonly cintura?: number;
  readonly pgc?: number;
}

export interface BodyGoal {
  readonly id: string;
  readonly patientId: string;
  readonly setByUserId: string;
  /** Vigência da meta em ISO `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  readonly values: BodyGoalValues;
  readonly createdAt: Date;
}

interface BodyGoalRow {
  id: string;
  patient_id: string;
  set_by_user_id: string;
  effective_from: string;
  values_enc: string;
  created_at: Date;
}

function toBodyGoal(row: BodyGoalRow, key: Buffer): BodyGoal {
  return {
    id: row.id,
    patientId: row.patient_id,
    setByUserId: row.set_by_user_id,
    effectiveFrom: row.effective_from,
    values: JSON.parse(decryptField(row.values_enc, key)) as BodyGoalValues,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Define metas corporais (nova versão, append) cifradas e auditadas.
 * Não sobrescreve versões anteriores — preserva qual meta valia em cada dia.
 */
export async function setBodyGoal(
  db: SqlExecutor,
  patientId: string,
  setByUserId: string,
  effectiveFrom: string,
  values: BodyGoalValues,
  key: Buffer,
  origin: WriteOrigin = { action: 'body-goal-set' },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO body_goal (patient_id, set_by_user_id, effective_from, values_enc)
     VALUES ($1, $2, $3::date, $4) RETURNING id`,
    [patientId, setByUserId, effectiveFrom, encryptField(JSON.stringify(values), key)],
  );
  const goalId = res.rows[0]!.id;
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
  return goalId;
}

/**
 * Meta corporal vigente numa data (default = hoje via `CURRENT_DATE` no banco):
 * a de maior `effective_from <= asOf`. Null se o paciente não tem meta.
 */
export async function loadCurrentBodyGoal(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
  asOf?: string,
): Promise<BodyGoal | null> {
  const res = await db.query<BodyGoalRow>(
    `SELECT id, patient_id, set_by_user_id, effective_from::text AS effective_from, values_enc, created_at
     FROM body_goal
     WHERE patient_id = $1 AND effective_from <= COALESCE($2::date, CURRENT_DATE)
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [patientId, asOf ?? null],
  );
  const row = res.rows[0];
  return row ? toBodyGoal(row, key) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// E12 — Metas nutricionais & registro diário de consumo (bot de Telegram)
//
// Metas (kcal/macros) são definidas pelo nutricionista e VERSIONADAS por append
// (a vigente é a de maior effective_from <= o dia consultado — sem UPDATE
// destrutivo, coerente com a cultura append-only do projeto). O consumo diário
// vem das fotos de prato (uma linha por foto). Tudo cifrado (NFR9) e auditado
// (NFR10), mesmo padrão de addBodyComposition. A estimativa é aproximada, não
// prescrição, e sem meta o serviço NÃO inventa alvo (ADR-015).
// ─────────────────────────────────────────────────────────────────────────────

/** Metas nutricionais alvo do dia (definidas pelo humano). */
export interface NutritionGoalValues {
  readonly kcal: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
}

export interface NutritionGoal {
  readonly id: string;
  readonly patientId: string;
  readonly setByUserId: string;
  /** Vigência da meta em ISO `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  readonly values: NutritionGoalValues;
  readonly createdAt: Date;
}

/** Confiança declarada da estimativa por foto (incerteza explícita — ADR-015). */
export type FoodConfidence = 'low' | 'medium' | 'high';

export interface FoodLogValues {
  readonly kcal: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly confidence?: FoodConfidence;
  readonly itemsLabel?: string;
}

export interface FoodLogEntry {
  readonly id: string;
  readonly patientId: string;
  readonly eatenAt: Date;
  readonly source: string;
  /** Referência do Telegram (file_id) — nunca a imagem em si (ADR-013). */
  readonly photoRef: string | null;
  readonly values: FoodLogValues;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
}

export interface FoodLogInput {
  readonly eatenAt: Date;
  readonly values: FoodLogValues;
  readonly source?: string;
  readonly photoRef?: string;
  readonly modelVersion?: string;
}

/** Progresso do dia: consumo somado vs. meta vigente (null se não há meta). */
export interface DailyProgress {
  readonly day: string;
  readonly consumed: NutritionGoalValues;
  readonly goal: NutritionGoalValues | null;
  readonly remaining: NutritionGoalValues | null;
}

interface NutritionGoalRow {
  id: string;
  patient_id: string;
  set_by_user_id: string;
  effective_from: string;
  values_enc: string;
  created_at: Date;
}

function toNutritionGoal(row: NutritionGoalRow, key: Buffer): NutritionGoal {
  return {
    id: row.id,
    patientId: row.patient_id,
    setByUserId: row.set_by_user_id,
    effectiveFrom: row.effective_from,
    values: JSON.parse(decryptField(row.values_enc, key)) as NutritionGoalValues,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Define uma meta nutricional (nova versão, append) cifrada e auditada.
 * Não sobrescreve versões anteriores — preserva o histórico (qual meta valia em
 * cada dia). `effectiveFrom` é ISO `YYYY-MM-DD`.
 */
export async function setNutritionGoal(
  db: SqlExecutor,
  patientId: string,
  setByUserId: string,
  effectiveFrom: string,
  values: NutritionGoalValues,
  key: Buffer,
  origin: WriteOrigin = { action: 'nutrition-goal-set' },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO nutrition_goal (patient_id, set_by_user_id, effective_from, values_enc)
     VALUES ($1, $2, $3::date, $4) RETURNING id`,
    [patientId, setByUserId, effectiveFrom, encryptField(JSON.stringify(values), key)],
  );
  const goalId = res.rows[0]!.id;
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? 'human-edit',
  });
  return goalId;
}

/**
 * Meta vigente numa data (default = hoje, via `CURRENT_DATE` no banco — sem
 * relógio implícito no app): a de maior `effective_from <= asOf`. `asOf` é ISO
 * `YYYY-MM-DD`. Retorna null se o paciente ainda não tem meta definida.
 */
export async function loadCurrentNutritionGoal(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
  asOf?: string,
): Promise<NutritionGoal | null> {
  const res = await db.query<NutritionGoalRow>(
    `SELECT id, patient_id, set_by_user_id, effective_from::text AS effective_from, values_enc, created_at
     FROM nutrition_goal
     WHERE patient_id = $1 AND effective_from <= COALESCE($2::date, CURRENT_DATE)
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [patientId, asOf ?? null],
  );
  const row = res.rows[0];
  return row ? toNutritionGoal(row, key) : null;
}

/** Histórico completo de metas do paciente (mais recentes primeiro). */
export async function listNutritionGoalHistory(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
): Promise<NutritionGoal[]> {
  const res = await db.query<NutritionGoalRow>(
    `SELECT id, patient_id, set_by_user_id, effective_from::text AS effective_from, values_enc, created_at
     FROM nutrition_goal WHERE patient_id = $1
     ORDER BY effective_from DESC, created_at DESC`,
    [patientId],
  );
  return res.rows.map((r) => toNutritionGoal(r, key));
}

interface FoodLogRow {
  id: string;
  patient_id: string;
  eaten_at: Date;
  source: string;
  photo_ref: string | null;
  values_enc: string;
  model_version: string | null;
  created_at: Date;
}

function toFoodLogEntry(row: FoodLogRow, key: Buffer): FoodLogEntry {
  return {
    id: row.id,
    patientId: row.patient_id,
    eatenAt: new Date(row.eaten_at),
    source: row.source,
    photoRef: row.photo_ref,
    values: JSON.parse(decryptField(row.values_enc, key)) as FoodLogValues,
    modelVersion: row.model_version,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Registra o consumo de uma foto de prato (blob cifrado + auditado). A origem
 * (`origin.action`, ex.: 'telegram-bot') e o `modelVersion` do estimador entram
 * na trilha de auditoria para proveniência (NFR10). A imagem NÃO é persistida —
 * só a estimativa e, opcionalmente, o `photoRef` (file_id — ADR-013).
 */
export async function addFoodLogEntry(
  db: SqlExecutor,
  patientId: string,
  input: FoodLogInput,
  key: Buffer,
  origin: WriteOrigin = { action: 'food-log-add' },
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO food_log_entry (patient_id, eaten_at, source, photo_ref, values_enc, model_version)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      patientId,
      input.eatenAt,
      input.source ?? 'telegram',
      input.photoRef ?? null,
      encryptField(JSON.stringify(input.values), key),
      input.modelVersion ?? null,
    ],
  );
  const entryId = res.rows[0]!.id;
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? input.modelVersion ?? 'human-edit',
  });
  return entryId;
}

/** Última entrada do diário do paciente (mais recente por `eaten_at`). Null se vazio. */
export async function findLatestFoodLogEntry(
  db: SqlExecutor,
  patientId: string,
  key: Buffer,
): Promise<FoodLogEntry | null> {
  const res = await db.query<FoodLogRow>(
    `SELECT id, patient_id, eaten_at, source, photo_ref, values_enc, model_version, created_at
     FROM food_log_entry WHERE patient_id = $1
     ORDER BY eaten_at DESC, created_at DESC
     LIMIT 1`,
    [patientId],
  );
  const row = res.rows[0];
  return row ? toFoodLogEntry(row, key) : null;
}

/**
 * Corrige os valores de uma entrada existente do diário (re-cifra + audita).
 * Usado quando o paciente ajusta a identificação do prato (ex.: "era frango,
 * não peixe"): ATUALIZA a entrada em vez de inserir outra — o consumo do dia
 * não duplica. O `patientId` no WHERE impede correção cruzada entre pacientes.
 * Retorna false se a entrada não existe (nada auditado).
 */
export async function updateFoodLogEntryValues(
  db: SqlExecutor,
  patientId: string,
  entryId: string,
  values: FoodLogValues,
  key: Buffer,
  modelVersion?: string,
  origin: WriteOrigin = { action: 'food-log-correct' },
): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    `UPDATE food_log_entry
     SET values_enc = $3, model_version = COALESCE($4, model_version)
     WHERE id = $1 AND patient_id = $2 RETURNING id`,
    [entryId, patientId, encryptField(JSON.stringify(values), key), modelVersion ?? null],
  );
  if (res.rows.length === 0) return false;
  await writeAudit(db, patientId, {
    triggeredBy: origin.action,
    kbSources: [],
    modelVersion: origin.modelVersion ?? modelVersion ?? 'human-edit',
  });
  return true;
}

/**
 * Janela UTC `[início, fim)` do dia local `dayISO` (`YYYY-MM-DD`), dado o offset
 * do fuso em minutos (local = UTC + offset; BR = -180). Explícito e testável —
 * sem relógio nem fuso implícito (mesmo princípio de {@link computeAge}).
 */
function localDayRangeUtc(
  dayISO: string,
  tzOffsetMinutes: number,
): { start: Date; end: Date } {
  const wallClockMs = Date.parse(`${dayISO}T00:00:00Z`);
  const startMs = wallClockMs - tzOffsetMinutes * 60_000;
  return { start: new Date(startMs), end: new Date(startMs + 24 * 60 * 60 * 1000) };
}

/**
 * Entradas de consumo do dia local `dayISO` (janela pelo offset explícito),
 * decifradas e em ordem cronológica.
 */
export async function listFoodLogByDay(
  db: SqlExecutor,
  patientId: string,
  dayISO: string,
  tzOffsetMinutes: number,
  key: Buffer,
): Promise<FoodLogEntry[]> {
  const { start, end } = localDayRangeUtc(dayISO, tzOffsetMinutes);
  const res = await db.query<FoodLogRow>(
    `SELECT id, patient_id, eaten_at, source, photo_ref, values_enc, model_version, created_at
     FROM food_log_entry
     WHERE patient_id = $1 AND eaten_at >= $2 AND eaten_at < $3
     ORDER BY eaten_at ASC, id ASC`,
    [patientId, start, end],
  );
  return res.rows.map((r) => toFoodLogEntry(r, key));
}

/**
 * Progresso do dia: soma o consumo (kcal/macros) das fotos do dia e compara com
 * a meta vigente naquele dia. Sem meta ⇒ `goal`/`remaining` = null (não inventa
 * alvo — ADR-015).
 */
export async function sumFoodLogForDay(
  db: SqlExecutor,
  patientId: string,
  dayISO: string,
  tzOffsetMinutes: number,
  key: Buffer,
): Promise<DailyProgress> {
  const entries = await listFoodLogByDay(db, patientId, dayISO, tzOffsetMinutes, key);
  const consumed: NutritionGoalValues = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + (Number(e.values.kcal) || 0),
      protein: acc.protein + (Number(e.values.protein) || 0),
      carbs: acc.carbs + (Number(e.values.carbs) || 0),
      fat: acc.fat + (Number(e.values.fat) || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const goal = await loadCurrentNutritionGoal(db, patientId, key, dayISO);
  const goalValues = goal?.values ?? null;
  const remaining: NutritionGoalValues | null = goalValues
    ? {
        kcal: goalValues.kcal - consumed.kcal,
        protein: goalValues.protein - consumed.protein,
        carbs: goalValues.carbs - consumed.carbs,
        fat: goalValues.fat - consumed.fat,
      }
    : null;

  return { day: dayISO, consumed, goal: goalValues, remaining };
}
