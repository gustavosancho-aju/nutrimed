import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';
import { TelemetryRegistry } from '@nutrimed/telemetry';
import { saveTelemetryReport, loadTelemetryReport } from './telemetry-store';

/**
 * F4 — telemetria persistida por consulta: o registry em memória morria a cada
 * deploy e cegou a investigação do relato do piloto de 15/07. O snapshot em
 * consultation_telemetry sobrevive a restart e alimenta o painel via fallback.
 */
describe('telemetry-store (persistência F4)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['telemetria@nutrimed.test', 'Dra. Demo', 'x'],
    );
    consultationId = await createConsultation(exec, res.rows[0]!.id, 'P', randomBytes(32));
  });

  afterAll(async () => {
    await db.close();
  });

  function populatedRegistry(): TelemetryRegistry {
    const t = new TelemetryRegistry();
    t.sessionStarted(consultationId, 1_000);
    t.llmUsage(consultationId, 500, 200);
    t.sttSegment(consultationId);
    t.sttSegment(consultationId);
    t.gateDecision(consultationId, 'deliver');
    t.gateDecision(consultationId, 'llm-skip');
    t.contributionLatency(consultationId, 1200);
    t.sessionEnded(consultationId, 61_000);
    return t;
  }

  it('round-trip: save → load devolve o ConsultationReport íntegro', async () => {
    const t = populatedRegistry();
    const report = t.report(consultationId);
    await saveTelemetryReport(exec, report, t.sessionBounds(consultationId));

    const loaded = await loadTelemetryReport(exec, consultationId);
    expect(loaded).toEqual(report);
    // colunas planas de agregação refletem o snapshot
    const row = await exec.query<{ llm_calls: number; stt_segments: number }>(
      'SELECT llm_calls, stt_segments FROM consultation_telemetry WHERE consultation_id = $1',
      [consultationId],
    );
    expect(row.rows[0]).toMatchObject({ llm_calls: 1, stt_segments: 2 });
  });

  it('upsert: 2º save atualiza a MESMA linha (sem duplicar)', async () => {
    const t = populatedRegistry();
    t.llmUsage(consultationId, 100, 50); // evolução da consulta
    await saveTelemetryReport(exec, t.report(consultationId), t.sessionBounds(consultationId));

    const count = await exec.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM consultation_telemetry WHERE consultation_id = $1',
      [consultationId],
    );
    expect(count.rows[0]!.n).toBe(1);
    const loaded = await loadTelemetryReport(exec, consultationId);
    expect(loaded!.cost.llmCalls).toBe(2);
  });

  it('consulta sem snapshot ⇒ null (o runtime cai para o registry em memória)', async () => {
    expect(await loadTelemetryReport(exec, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
