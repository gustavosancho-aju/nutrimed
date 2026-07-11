import type { SqlExecutor } from '@nutrimed/db';

/**
 * Autorização por POSSE da consulta (defesa contra BOLA/IDOR). Operações que
 * recebem um `consultationId` do cliente (nota, relatório, consentimento,
 * transcrição, board, telemetria) DEVEM confirmar que a consulta pertence ao
 * médico autenticado — a autenticação sozinha não basta, pois um médico
 * poderia agir sobre a consulta de outro conhecendo o UUID.
 *
 * O escopo já era garantido no nível do paciente (assertOwner) e no WebSocket;
 * este helper leva a mesma garantia às server actions e API routes por consulta.
 */

/** True se a consulta existe E pertence ao usuário. Não vaza existência. */
export async function consultationBelongsTo(
  db: SqlExecutor,
  consultationId: string,
  userId: string,
): Promise<boolean> {
  if (!consultationId) return false;
  const res = await db.query<{ id: string }>(
    'SELECT id FROM consultation WHERE id = $1 AND user_id = $2',
    [consultationId, userId],
  );
  return res.rows.length > 0;
}

/**
 * Garante a posse; lança `ConsultationNotFoundError` (mensagem genérica, não
 * vaza se a consulta existe para outro médico) quando não pertence ao usuário.
 */
export async function assertConsultationOwner(
  db: SqlExecutor,
  consultationId: string,
  userId: string,
): Promise<void> {
  if (!(await consultationBelongsTo(db, consultationId, userId))) {
    const err = new Error('Consulta não encontrada para este médico.');
    err.name = 'ConsultationNotFoundError';
    throw err;
  }
}
