import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { createConsultation, grantConsent } from '@nutrimed/consent';
import type { ISttProvider, SttSession, SttOpenOptions, TranscriptSegment } from '@nutrimed/providers';
import { startConsultationSession } from './session';

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

/** Provider roteirizado: cada openStream consome o próximo roteiro (segmentos ou erro). */
type Script = Array<TranscriptSegment | Error>;
class ScriptedSttProvider implements ISttProvider {
  openCalls: SttOpenOptions[] = [];
  constructor(private readonly scripts: Script[]) {}

  openStream(opts: SttOpenOptions): SttSession {
    this.openCalls.push(opts);
    const script = this.scripts.shift() ?? [];
    let closed = false;
    let onClose: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      onClose = resolve;
    });
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        for (const item of script) {
          if (closed) return;
          if (item instanceof Error) throw item;
          yield item;
        }
        // roteiro esgotado: stream fica aberto até close() acordar
        await closedPromise;
      },
      async close(): Promise<void> {
        closed = true;
        onClose?.();
      },
    };
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const noDelay = async () => {};

describe('Resiliência da sessão (Story 2.6)', () => {
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

  describe('AC2 — recuperação automática sem duplicar segmentos', () => {
    it('erro → degraded → reabre → volta a live preservando o acumulado', async () => {
      const stt = new ScriptedSttProvider([
        [{ text: 'antes da queda.', isFinal: true }, new Error('stt caiu')],
        [{ text: 'depois da volta.', isFinal: true }],
      ]);
      const session = await startConsultationSession(exec, consultationId, stt, {
        delay: noDelay,
      });
      const statuses: string[] = [];
      session.subscribe((e) => {
        if (e.type === 'status') statuses.push(e.status);
      });

      await flush();
      const snap = session.getSnapshot();
      expect(snap.status).toBe('live'); // recuperou
      expect(snap.finalSegments.map((s) => s.text)).toEqual([
        'antes da queda.',
        'depois da volta.', // sem duplicação, acumulado preservado
      ]);
      expect(statuses).toEqual(['degraded', 'live']);
      expect(stt.openCalls).toHaveLength(2); // reabriu exatamente 1 vez
      await session.stop();
    });

    it('esgotadas as tentativas, permanece degraded sem travar', async () => {
      const stt = new ScriptedSttProvider([
        [new Error('e1')],
        [new Error('e2')],
        [new Error('e3')],
      ]);
      const session = await startConsultationSession(exec, consultationId, stt, {
        delay: noDelay,
        maxRetries: 2,
      });
      await flush();
      expect(session.getSnapshot().status).toBe('degraded');
      expect(stt.openCalls).toHaveLength(3); // inicial + 2 retries
      expect(session.getSnapshot().error?.message).toBe('e3');
    });

    it('backoff exponencial: delays 500/1000/2000 com base default', async () => {
      const delays: number[] = [];
      const stt = new ScriptedSttProvider([
        [new Error('a')],
        [new Error('b')],
        [new Error('c')],
        [new Error('d')],
      ]);
      const session = await startConsultationSession(exec, consultationId, stt, {
        delay: async (ms) => {
          delays.push(ms);
        },
      });
      await flush();
      expect(delays).toEqual([500, 1000, 2000]);
      expect(session.getSnapshot().status).toBe('degraded');
    });
  });

  describe('AC3 — vocabulário clínico aplicado ao abrir o stream', () => {
    it('vocabularyBoost chega ao provider em TODAS as aberturas (inclusive retry)', async () => {
      const stt = new ScriptedSttProvider([[new Error('cai')], []]);
      const session = await startConsultationSession(exec, consultationId, stt, {
        delay: noDelay,
        vocabularyBoost: ['semaglutida', 'TSH'],
      });
      await flush();
      expect(stt.openCalls).toHaveLength(2);
      for (const call of stt.openCalls) {
        expect(call.vocabularyBoost).toEqual(['semaglutida', 'TSH']);
      }
      await session.stop();
    });
  });
});
