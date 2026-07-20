import type { SqlExecutor, ConsentRow } from '@nutrimed/db';
import { encryptField } from '@nutrimed/crypto';
import { writeAudit } from '@nutrimed/audit';

/**
 * Consent Service (FR20) — consentimento de gravação como GATE de servidor.
 *
 * Princípio de compliance-by-design (ADR-006): o servidor é a ÚNICA fonte de
 * verdade sobre se a captura de áudio pode ocorrer. Nenhum caminho de captura
 * (E2) deve ligar sem antes passar por {@link assertCaptureAuthorized}. O cliente
 * nunca decide — apenas reflete o veredito do servidor (AC1, AC3, AC6).
 *
 * Modelo (architecture.md §8): `CONSULTATION ||--|| CONSENT` (1:1). Cada consulta
 * tem exatamente uma linha de consentimento (UNIQUE consultation_id), criada já
 * na abertura da consulta com `granted = false` — ou seja, o default é NEGAR.
 */

export interface ConsentStatus {
  consultationId: string;
  granted: boolean;
  grantedBy: string | null;
  grantedAt: Date | null;
}

/** Lançado quando uma captura é tentada sem consentimento válido (AC1/AC6). */
export class ConsentRequiredError extends Error {
  readonly consultationId: string;
  constructor(consultationId: string) {
    super(`Captura bloqueada: consentimento de gravação ausente ou revogado (consulta ${consultationId}).`);
    this.name = 'ConsentRequiredError';
    this.consultationId = consultationId;
  }
}

/**
 * Abre uma consulta e cria sua linha de consentimento com default NEGADO.
 * O rótulo do paciente é cifrado em repouso (NFR9) antes de tocar o banco.
 * Retorna o id da consulta criada.
 *
 * `patientId` (E11/FR23) vincula a consulta a um paciente real quando informado.
 * É opcional e nullable: consultas antigas (rótulo solto) continuam válidas sem
 * paciente — não quebra o caminho legado.
 */
export async function createConsultation(
  db: SqlExecutor,
  userId: string,
  patientLabel: string,
  encryptionKey: Buffer,
  patientId: string | null = null,
): Promise<string> {
  const labelEnc = encryptField(patientLabel, encryptionKey);
  const res = await db.query<{ id: string }>(
    'INSERT INTO consultation (user_id, patient_label_enc, patient_id) VALUES ($1, $2, $3) RETURNING id',
    [userId, labelEnc, patientId],
  );
  const consultationId = res.rows[0]!.id;
  // 1:1 com CONSULTATION — default granted=false (nega por omissão, AC1).
  await db.query('INSERT INTO consent (consultation_id, granted) VALUES ($1, false)', [
    consultationId,
  ]);
  return consultationId;
}

/** Resumo de uma consulta para o histórico da ficha do paciente (E11/11.5). */
export interface ConsultationSummary {
  id: string;
  status: string;
  createdAt: Date;
}

/**
 * Lista as consultas de um paciente (FR24), mais recente primeiro. Retorna só
 * metadados não sensíveis (id/status/data) — nenhum campo cifrado é exposto.
 */
export async function listConsultationsByPatient(
  db: SqlExecutor,
  patientId: string,
): Promise<ConsultationSummary[]> {
  const res = await db.query<{ id: string; status: string; created_at: Date }>(
    'SELECT id, status, created_at FROM consultation WHERE patient_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
    [patientId],
  );
  return res.rows.map((r) => ({ id: r.id, status: r.status, createdAt: new Date(r.created_at) }));
}

/**
 * Muda o status da consulta e AUDITA a transição (NFR10). Criado no ciclo 2:
 * até então toda consulta ficava 'open' para sempre — 'closed' habilita o modo
 * releitura do registro da consulta.
 */
export async function setConsultationStatus(
  db: SqlExecutor,
  consultationId: string,
  status: 'open' | 'closed',
): Promise<void> {
  const res = await db.query<{ id: string }>(
    'UPDATE consultation SET status = $2 WHERE id = $1 RETURNING id',
    [consultationId, status],
  );
  if (res.rows.length === 0) throw new Error(`Consulta ${consultationId} não encontrada.`);
  await writeAudit(db, consultationId, {
    triggeredBy: status === 'closed' ? 'consultation-close' : 'consultation-reopen',
    kbSources: [],
    modelVersion: 'human-edit',
  });
}

/** Modo do board durante a consulta ao vivo (briefing do piloto 2026-07-19). */
export type BoardMode = 'live' | 'final_only';

/** Desfecho do parecer final gerado ao encerrar a consulta. */
export type FinalReviewStatus = 'pending' | 'done' | 'failed';

/** Metadados da consulta COM posse (user_id no WHERE) — null se não pertence. */
export interface ConsultationMeta {
  readonly id: string;
  readonly status: string;
  readonly patientId: string | null;
  readonly boardMode: BoardMode;
  readonly finalReviewStatus: FinalReviewStatus | null;
  readonly createdAt: Date;
}

export async function getConsultationMeta(
  db: SqlExecutor,
  consultationId: string,
  userId: string,
): Promise<ConsultationMeta | null> {
  const res = await db.query<{
    id: string;
    status: string;
    patient_id: string | null;
    board_mode: string;
    final_review_status: string | null;
    created_at: Date;
  }>(
    `SELECT id, status, patient_id, board_mode, final_review_status, created_at
     FROM consultation WHERE id = $1 AND user_id = $2`,
    [consultationId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    patientId: row.patient_id,
    boardMode: row.board_mode === 'final_only' ? 'final_only' : 'live',
    finalReviewStatus: (row.final_review_status as FinalReviewStatus | null) ?? null,
    createdAt: new Date(row.created_at),
  };
}

/** Define o modo do board (escolhido ao iniciar a consulta ao vivo). */
export async function setConsultationBoardMode(
  db: SqlExecutor,
  consultationId: string,
  mode: BoardMode,
): Promise<void> {
  await db.query('UPDATE consultation SET board_mode = $2 WHERE id = $1', [consultationId, mode]);
}

/**
 * Atualiza o status do parecer final (pending ao encerrar → done/failed
 * quando as chamadas ao LLM terminam). Não audita por transição — a
 * auditoria clínica do parecer em si acontece em `saveBoardFinalReview`
 * (NFR10); este campo é só controle de UI (spinner/retry).
 */
export async function setFinalReviewStatus(
  db: SqlExecutor,
  consultationId: string,
  status: FinalReviewStatus,
): Promise<void> {
  await db.query('UPDATE consultation SET final_review_status = $2 WHERE id = $1', [
    consultationId,
    status,
  ]);
}

/**
 * Concede o consentimento de gravação para a consulta, registrando quem
 * consentiu e quando (AC2/AC5). Idempotente: reconceder apenas atualiza o
 * carimbo. Falha se a consulta não tiver linha de consentimento.
 */
export async function grantConsent(
  db: SqlExecutor,
  consultationId: string,
  grantedByUserId: string,
): Promise<void> {
  const res = await db.query<{ consultation_id: string }>(
    `UPDATE consent
       SET granted = true, granted_by = $2, granted_at = now(), updated_at = now()
     WHERE consultation_id = $1
     RETURNING consultation_id`,
    [consultationId, grantedByUserId],
  );
  assertAffected(res, consultationId);
}

/**
 * Revoga o consentimento (AC4). A captura em andamento deve ser interrompida:
 * a próxima checagem do gate ({@link isCaptureAuthorized}) passará a negar.
 * Mantém `granted_by`/`granted_at` do consentimento anterior para rastreio.
 */
export async function revokeConsent(db: SqlExecutor, consultationId: string): Promise<void> {
  const res = await db.query<{ consultation_id: string }>(
    `UPDATE consent SET granted = false, updated_at = now()
     WHERE consultation_id = $1
     RETURNING consultation_id`,
    [consultationId],
  );
  assertAffected(res, consultationId);
}

/** Estado atual do consentimento de uma consulta (null se a consulta não existe). */
export async function getConsentStatus(
  db: SqlExecutor,
  consultationId: string,
): Promise<ConsentStatus | null> {
  const res = await db.query<Pick<ConsentRow, 'granted' | 'granted_by' | 'granted_at'>>(
    'SELECT granted, granted_by, granted_at FROM consent WHERE consultation_id = $1',
    [consultationId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    consultationId,
    granted: row.granted,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at ? new Date(row.granted_at) : null,
  };
}

/**
 * GATE DE SERVIDOR (AC1/AC3/AC6) — fonte de verdade da autorização de captura.
 * Retorna true apenas se existir consentimento válido (granted=true) para a
 * consulta. Ausência de linha ou revogação ⇒ false. Nunca confia no cliente.
 */
export async function isCaptureAuthorized(
  db: SqlExecutor,
  consultationId: string,
): Promise<boolean> {
  const res = await db.query<{ granted: boolean }>(
    'SELECT granted FROM consent WHERE consultation_id = $1',
    [consultationId],
  );
  return res.rows[0]?.granted === true;
}

/**
 * Versão imperativa do gate para os pontos de entrada de captura (E2): lança
 * {@link ConsentRequiredError} se a captura não estiver autorizada. Garante
 * (AC6) que nenhum áudio seja capturado/transmitido sem passar por aqui.
 */
export async function assertCaptureAuthorized(
  db: SqlExecutor,
  consultationId: string,
): Promise<void> {
  if (!(await isCaptureAuthorized(db, consultationId))) {
    throw new ConsentRequiredError(consultationId);
  }
}

/** Garante que o UPDATE atingiu uma consulta existente (gate nunca falha em silêncio). */
function assertAffected(res: { rows: unknown[] }, consultationId: string): void {
  if (res.rows.length === 0) {
    throw new Error(`Consulta ${consultationId} não encontrada (sem linha de consentimento).`);
  }
}
