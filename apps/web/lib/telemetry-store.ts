import type { SqlExecutor } from '@nutrimed/db';
import type { ConsultationReport } from '@nutrimed/telemetry';

/**
 * Persistência da telemetria por consulta (F4 — pós-incidente 15/07: o registry
 * em memória morria a cada deploy e cegava a investigação dos relatos do piloto).
 *
 * ADAPTER fora do pacote @nutrimed/telemetry de propósito: o registry continua
 * puro/em memória/sem dependência de db. Aqui serializamos o ConsultationReport
 * PRONTO (percentis já calculados — nunca o array cru de latências) em JSONB +
 * colunas planas para agregação SQL. Sem conteúdo clínico ⇒ sem cifra (NFR9 ok).
 */

export async function saveTelemetryReport(
  db: SqlExecutor,
  report: ConsultationReport,
  bounds: { startedAt: number | null; endedAt: number | null; sttSegments: number },
): Promise<void> {
  await db.query(
    `INSERT INTO consultation_telemetry (
       consultation_id, started_at, ended_at, llm_calls, llm_input_tokens,
       llm_output_tokens, stt_segments, contributions_delivered,
       case_state_updates, report, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (consultation_id) DO UPDATE SET
       started_at = EXCLUDED.started_at,
       ended_at = EXCLUDED.ended_at,
       llm_calls = EXCLUDED.llm_calls,
       llm_input_tokens = EXCLUDED.llm_input_tokens,
       llm_output_tokens = EXCLUDED.llm_output_tokens,
       stt_segments = EXCLUDED.stt_segments,
       contributions_delivered = EXCLUDED.contributions_delivered,
       case_state_updates = EXCLUDED.case_state_updates,
       report = EXCLUDED.report,
       updated_at = now()`,
    [
      report.consultationId,
      bounds.startedAt !== null ? new Date(bounds.startedAt) : null,
      bounds.endedAt !== null ? new Date(bounds.endedAt) : null,
      report.cost.llmCalls,
      report.cost.llmInputTokens,
      report.cost.llmOutputTokens,
      bounds.sttSegments,
      report.acceptance.delivered,
      report.autonomy.caseStateUpdates,
      JSON.stringify(report),
    ],
  );
}

/** Relatório persistido da consulta (null se nunca houve flush). */
export async function loadTelemetryReport(
  db: SqlExecutor,
  consultationId: string,
): Promise<ConsultationReport | null> {
  const res = await db.query<{ report: ConsultationReport | string }>(
    'SELECT report FROM consultation_telemetry WHERE consultation_id = $1',
    [consultationId],
  );
  const raw = res.rows[0]?.report;
  if (!raw) return null;
  // pg devolve jsonb como objeto; PGlite pode devolver string — tolerante aos dois
  return typeof raw === 'string' ? (JSON.parse(raw) as ConsultationReport) : raw;
}
