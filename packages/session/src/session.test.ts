import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@nutrimed/db';
import {
  createConsultation,
  grantConsent,
  ConsentRequiredError,
} from '@nutrimed/consent';
import {
  FakeSttProvider,
  type ISttProvider,
  type SttSession,
  type TranscriptSegment,
} from '@nutrimed/providers';
import { startConsultationSession, type SessionEvent } from './session';


/** STT controlável: segmentos são empurrados pelo teste; pode falhar sob demanda. */
class PushSttProvider implements ISttProvider {
  private queue: Array<TranscriptSegment | Error | null> = [];
  private wake: (() => void) | null = null;

  push(item: TranscriptSegment | Error | null): void {
    this.queue.push(item);
    this.wake?.();
  }

  openStream(): SttSession {
    const queue = this.queue;
    const setWake = (fn: (() => void) | null): void => {
      this.wake = fn;
    };
    const callWake = (): void => this.wake?.();
    let closed = false;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        for (;;) {
          if (closed) return;
          const item = queue.shift();
          if (item === undefined) {
            await new Promise<void>((resolve) => {
              setWake(resolve);
            });
            continue;
          }
          if (item === null) return; // fim natural do stream
          if (item instanceof Error) throw item;
          yield item;
        }
      },
      async close(): Promise<void> {
        closed = true;
        callWake();
      },
    };
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Consultation Session Service (Story 2.3)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let authorizedConsultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dr. Aurélio', 'x'],
    );
    userId = res.rows[0]!.id;
    authorizedConsultationId = await createConsultation(
      exec,
      userId,
      'Paciente — sessão',
      randomBytes(32),
    );
    await grantConsent(exec, authorizedConsultationId, userId);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('AC4 — gate de consentimento antes de ligar o consumo', () => {
    it('sem consentimento, a sessão NÃO inicia (ConsentRequiredError)', async () => {
      const blockedId = await createConsultation(exec, userId, 'Sem consent', randomBytes(32));
      await expect(
        startConsultationSession(exec, blockedId, new FakeSttProvider()),
      ).rejects.toBeInstanceOf(ConsentRequiredError);
    });

    it('com consentimento, a sessão inicia e consome o stream', async () => {
      const session = await startConsultationSession(
        exec,
        authorizedConsultationId,
        new FakeSttProvider(),
      );
      await flush();
      const snap = session.getSnapshot();
      expect(snap.finalSegments.map((s) => s.text)).toEqual([
        'Paciente em GLP-1 com cansaço e platô no peso.',
      ]);
      await session.stop();
    });
  });

  describe('AC1/AC2 — acúmulo: parciais substituem a ponta, finais imutáveis sem duplicação', () => {
    it('parcial atualiza a ponta; final acrescenta e limpa o parcial', async () => {
      const stt = new PushSttProvider();
      const session = await startConsultationSession(exec, authorizedConsultationId, stt);

      stt.push({ text: 'Pac', isFinal: false });
      await flush();
      expect(session.getSnapshot().partial?.text).toBe('Pac');
      expect(session.getSnapshot().finalSegments).toHaveLength(0);

      stt.push({ text: 'Paciente com', isFinal: false });
      await flush();
      expect(session.getSnapshot().partial?.text).toBe('Paciente com');

      stt.push({ text: 'Paciente com cefaleia.', isFinal: true });
      stt.push({ text: 'Refere', isFinal: false });
      stt.push({ text: 'Refere tontura.', isFinal: true });
      await flush();

      const snap = session.getSnapshot();
      expect(snap.finalSegments.map((s) => s.text)).toEqual([
        'Paciente com cefaleia.',
        'Refere tontura.',
      ]);
      expect(snap.partial).toBeNull();
      await session.stop();
    });
  });

  describe('AC3 — assinatura de eventos', () => {
    it('notifica segmentos e permite unsubscribe sem vazamento', async () => {
      const stt = new PushSttProvider();
      const session = await startConsultationSession(exec, authorizedConsultationId, stt);
      const events: SessionEvent[] = [];
      const unsubscribe = session.subscribe((e) => events.push(e));

      stt.push({ text: 'olá', isFinal: true });
      await flush();
      expect(events.filter((e) => e.type === 'segment')).toHaveLength(1);

      unsubscribe();
      stt.push({ text: 'depois do unsubscribe', isFinal: true });
      await flush();
      expect(events.filter((e) => e.type === 'segment')).toHaveLength(1);
      await session.stop();
    });
  });

  describe('AC6 — erro do STT degrada sem derrubar', () => {
    it('falha do stream muda status para degraded e preserva o acumulado', async () => {
      const stt = new PushSttProvider();
      const session = await startConsultationSession(exec, authorizedConsultationId, stt);
      const statuses: string[] = [];
      session.subscribe((e) => {
        if (e.type === 'status') statuses.push(e.status);
      });

      stt.push({ text: 'antes do erro.', isFinal: true });
      stt.push(new Error('stt caiu'));
      await flush();

      const snap = session.getSnapshot();
      expect(snap.status).toBe('degraded');
      expect(snap.error?.message).toBe('stt caiu');
      expect(snap.finalSegments.map((s) => s.text)).toEqual(['antes do erro.']);
      expect(statuses).toContain('degraded');
    });
  });

  describe('AC5 — encerramento limpo', () => {
    it('stop fecha o stream, preserva o acumulado e marca ended', async () => {
      const stt = new PushSttProvider();
      const session = await startConsultationSession(exec, authorizedConsultationId, stt);
      stt.push({ text: 'consolidado.', isFinal: true });
      await flush();

      await session.stop();
      const snap = session.getSnapshot();
      expect(snap.status).toBe('ended');
      expect(snap.finalSegments.map((s) => s.text)).toEqual(['consolidado.']);

      // idempotente
      await expect(session.stop()).resolves.toBeUndefined();
    });
  });
});
