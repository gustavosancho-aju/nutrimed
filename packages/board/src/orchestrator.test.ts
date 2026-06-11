import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { createConsultation, grantConsent } from '@nutrimed/consent';
import { getAuditTrail } from '@nutrimed/audit';
import {
  FakeLlmProvider,
  type ISttProvider,
  type SttSession,
  type TranscriptSegment,
  type LlmCompletionRequest,
  type PersonaContribution,
} from '@nutrimed/providers';
import { startConsultationSession } from '@nutrimed/session';
import { BoardOrchestrator, type BoardContributionEvent } from './orchestrator';

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

class PushSttProvider implements ISttProvider {
  private queue: Array<TranscriptSegment | null> = [];
  private wake: (() => void) | null = null;
  push(item: TranscriptSegment | null): void {
    this.queue.push(item);
    this.wake?.();
  }
  openStream(): SttSession {
    const self = this;
    let closed = false;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        for (;;) {
          if (closed) return;
          const item = self.queue.shift();
          if (item === undefined) {
            await new Promise<void>((r) => {
              self.wake = r;
            });
            continue;
          }
          if (item === null) return;
          yield item;
        }
      },
      async close(): Promise<void> {
        closed = true;
        self.wake?.();
      },
    };
  }
}

/** LLM fake com modelVersion (proveniência) e captura da requisição. */
class RecordingLlm extends FakeLlmProvider {
  lastRequest: LlmCompletionRequest | null = null;
  override async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
    this.lastRequest = req;
    const base = await super.complete(req);
    return { ...base, personaId: 'paulo', type: 'atencao', modelVersion: 'fake-llm-v1' };
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('BoardOrchestrator — walking skeleton (Story 3.1)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dr. Aurélio', 'x'],
    );
    const userId = res.rows[0]!.id;
    consultationId = await createConsultation(exec, userId, 'P', randomBytes(32));
    await grantConsent(exec, consultationId, userId);
  });

  afterAll(async () => {
    await db.close();
  });

  async function setup(opts: { cooldownMs?: number; now?: () => number } = {}) {
    const stt = new PushSttProvider();
    const session = await startConsultationSession(exec, consultationId, stt);
    const llm = new RecordingLlm();
    const orchestrator = new BoardOrchestrator(exec, session, llm, opts);
    const events: BoardContributionEvent[] = [];
    orchestrator.subscribe((e) => events.push(e));
    orchestrator.start();
    return { stt, session, llm, orchestrator, events };
  }

  it('AC1/AC2/AC3 — gatilho CV no segmento FINAL dispara 1 contribuição do Paulo', async () => {
    const { stt, session, llm, orchestrator, events } = await setup();

    stt.push({ text: 'Vou iniciar semaglutida e a paciente referiu palpitação.', isFinal: true });
    await flush();
    await orchestrator.flush();

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.contribution.personaId).toBe('paulo');
    expect(event.triggeredBy).toBe('paulo-seguranca-cv-farmacos');
    expect(event.consultationId).toBe(consultationId);
    // contexto mínimo: system da persona + transcript recente (sem RAG — E5)
    expect(llm.lastRequest?.system).toContain('Dr. Paulo');
    expect(llm.lastRequest?.transcript).toContain('semaglutida');
    expect(llm.lastRequest?.context).toEqual([]);

    orchestrator.stop();
    await session.stop();
  });

  it('AC7 — segmento sem gatilho (ou parcial com gatilho) → silêncio', async () => {
    const { stt, orchestrator, session, events } = await setup();

    stt.push({ text: 'Paciente relata boa adesão à dieta.', isFinal: true });
    stt.push({ text: 'pensando em GLP-1', isFinal: false }); // parcial NÃO dispara
    await flush();
    await orchestrator.flush();

    expect(events).toHaveLength(0);
    orchestrator.stop();
    await session.stop();
  });

  it('AC4 — contribuição publicada tem trilha de auditoria com proveniência (NFR10)', async () => {
    const { stt, orchestrator, session, events } = await setup();

    stt.push({ text: 'Considerar sibutramina para este caso.', isFinal: true });
    await flush();
    await orchestrator.flush();

    const trail = await getAuditTrail(exec, events[0]!.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!).toMatchObject({
      triggeredBy: 'paulo-seguranca-cv-farmacos',
      modelVersion: 'fake-llm-v1',
      kbSources: [],
    });
    orchestrator.stop();
    await session.stop();
  });

  it('AC5 — cooldown: dois gatilhos na mesma janela → 1 contribuição; após a janela → 2ª sai', async () => {
    let t = 0;
    const { stt, orchestrator, session, events } = await setup({
      cooldownMs: 1000,
      now: () => t,
    });

    stt.push({ text: 'Iniciando GLP-1 hoje.', isFinal: true });
    await flush();
    await orchestrator.flush();
    stt.push({ text: 'Reforçando: GLP-1 semanal.', isFinal: true });
    await flush();
    await orchestrator.flush();
    expect(events).toHaveLength(1); // dentro do cooldown

    t = 2000; // janela passou
    stt.push({ text: 'Paciente perguntou de novo sobre GLP-1.', isFinal: true });
    await flush();
    await orchestrator.flush();
    expect(events).toHaveLength(2);

    orchestrator.stop();
    await session.stop();
  });

  it('AC6 — stop() limpa assinaturas; novos segmentos não geram eventos', async () => {
    const { stt, orchestrator, session, events } = await setup();
    orchestrator.stop();

    stt.push({ text: 'GLP-1 mencionado após o stop.', isFinal: true });
    await flush();
    await orchestrator.flush();
    expect(events).toHaveLength(0);
    await session.stop();
  });

  it('falha do LLM não derruba nada — contribuição só não é publicada', async () => {
    const stt = new PushSttProvider();
    const session = await startConsultationSession(exec, consultationId, stt);
    const failingLlm = {
      complete: async () => {
        throw new Error('llm caiu');
      },
    };
    const orchestrator = new BoardOrchestrator(exec, session, failingLlm);
    const events: BoardContributionEvent[] = [];
    orchestrator.subscribe((e) => events.push(e));
    orchestrator.start();

    stt.push({ text: 'GLP-1 com erro no LLM.', isFinal: true });
    await flush();
    await orchestrator.flush();

    expect(events).toHaveLength(0);
    expect(session.getSnapshot().status).toBe('live'); // consulta segue
    orchestrator.stop();
    await session.stop();
  });
});
