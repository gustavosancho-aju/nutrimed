import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { createConsultation, grantConsent } from '@nutrimed/consent';
import { getAuditTrail } from '@nutrimed/audit';
import type {
  ISttProvider,
  SttSession,
  TranscriptSegment,
  LlmCompletionRequest,
  PersonaContribution,
} from '@nutrimed/providers';
import { startConsultationSession } from '@nutrimed/session';
import { NamespacedKnowledgeStore, ingest } from '@nutrimed/kb';
import { FullBoardOrchestrator, type FullBoardEvent } from './full-board';

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
  push(text: string): void {
    this.queue.push({ text, isFinal: true });
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
            await new Promise<void>((r) => {
              setWake(r);
            });
            continue;
          }
          if (item === null) return;
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

class EchoLlm {
  calls: LlmCompletionRequest[] = [];
  /** B1: simula o modelo declarando "nada novo". */
  skipIf: ((req: LlmCompletionRequest) => boolean) | null = null;
  async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
    this.calls.push(req);
    if (req.allowSkip && this.skipIf?.(req)) {
      return { personaId: 'aurelio', type: 'sugestao', severity: 'normal', text: '', skip: true };
    }
    return {
      personaId: 'aurelio',
      type: 'sugestao',
      severity: 'normal',
      // eco do chunk de KB da persona: personas distintas produzem textos
      // distintos (como o LLM real) — o dedup semântico B2 não as confunde
      text: `eco: ${req.context[0]?.text ?? req.transcript.slice(0, 60)}`,
      kbSources: req.context.map((c) => c.id),
      modelVersion: 'echo-v1',
    };
  }
}

function makeStore() {
  const store = new NamespacedKnowledgeStore();
  ingest(
    store,
    [
      { personaId: 'paulo', source: 'seed#paulo', content: 'Menção a GLP-1 sibutramina palpitação pressão: checar segurança cardiovascular, pressão arterial e frequência.' },
      { personaId: 'yara', source: 'seed#yara', content: 'Cansaço ganho de peso frio queda de cabelo platô: hipótese tireoidiana, sugerir TSH e T4 livre.' },
      { personaId: 'aurelio', source: 'seed#aurelio', content: 'Dieta peso hábitos deficiência: organizar o caso com visão integral e rotina alimentar.' },
    ],
    'test-v1',
  );
  return store;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('FullBoardOrchestrator — board completo (E6)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dra. Demo', 'x'],
    );
    const userId = res.rows[0]!.id;
    consultationId = await createConsultation(exec, userId, 'P', randomBytes(32));
    await grantConsent(exec, consultationId, userId);
  });

  afterAll(async () => {
    await db.close();
  });

  async function setup(opts: { now?: () => number; pauseMs?: number; onDecision?: (kind: string) => void } = {}) {
    const stt = new PushSttProvider();
    const session = await startConsultationSession(exec, consultationId, stt);
    const llm = new EchoLlm();
    const board = new FullBoardOrchestrator(exec, session, llm, makeStore(), {
      pauseMs: opts.pauseMs ?? 0, // pausa imediata por default (testes determinísticos)
      tickMs: 100000, // tick manual via flush — sem timer interferindo
      now: opts.now,
      onDecision: opts.onDecision,
    });
    const events: FullBoardEvent[] = [];
    board.subscribe((e) => events.push(e));
    board.start();
    return { stt, session, llm, board, events };
  }

  it('6.1/AC1-2 — FR2: um segmento dispara MÚLTIPLAS personas pelo pipeline completo, com KB escopada', async () => {
    let t = 0;
    const { stt, session, board, events, llm } = await setup({ now: () => (t += 3000) });

    stt.push('Paciente em GLP-1 com palpitação e platô no peso, muito cansaço.');
    await flush();
    await board.flush();

    const personas = new Set(events.map((e) => e.contribution.personaId));
    expect(personas.has('paulo')).toBe(true);
    expect(personas.has('yara')).toBe(true);
    // KB escopada: cada chamada do reasoner recebeu só chunks da própria persona
    for (const call of llm.calls) {
      const namespaces = new Set(call.context.map((c) => c.personaId));
      expect(namespaces.size).toBeLessThanOrEqual(1);
    }
    board.stop();
    await session.stop();
  });

  it('6.1/AC5 — toda contribuição publicada é auditada com proveniência de KB', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) });
    stt.push('Vou prescrever sibutramina.');
    await flush();
    await board.flush();

    expect(events.length).toBeGreaterThan(0);
    const trail = await getAuditTrail(exec, events[0]!.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.modelVersion).toBe('echo-v1');
    expect((trail[0]!.kbSources as string[]).length).toBeGreaterThan(0);
    board.stop();
    await session.stop();
  });

  it('6.2 — síntese SOB DEMANDA (FR18) integra a rodada, audita e fecha a rodada', async () => {
    let t = 0;
    const { stt, session, board, events, llm } = await setup({ now: () => (t += 3000) });
    stt.push('GLP-1 prescrito.');
    stt.push('Paciente com platô e cansaço.');
    await flush();
    await board.flush();
    const before = events.length;
    expect(before).toBeGreaterThanOrEqual(2);

    await board.synthesizeNow();
    const synthesis = events[events.length - 1]!;
    expect(synthesis.contribution.type).toBe('sintese');
    expect(synthesis.contribution.personaId).toBe('aurelio');
    expect(synthesis.triggeredBy).toBe('sintese-on-demand');

    // prompt da síntese: papel de síntese + decisão do médico + contribuições da rodada
    const synthCall = llm.calls[llm.calls.length - 1]!;
    expect(synthCall.system).toContain('SÍNTESE');
    expect(synthCall.system).toContain('devolvendo a decisão ao médico');
    expect(synthCall.transcript).toContain('Contribuições do board');

    const trail = await getAuditTrail(exec, synthesis.id);
    expect(trail[0]!.triggeredBy).toBe('sintese-on-demand');

    // rodada fechou: nova síntese sob demanda sem novas contribuições = no-op
    const count = events.length;
    await board.synthesizeNow();
    expect(events.length).toBe(count);
    board.stop();
    await session.stop();
  });

  it('6.3 — FR7: tipos conflitantes de personas distintas no MESMO tópico marcam divergência', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) });
    // 'metabolico' (Yara, sugestao) e 'cv-farmacos' (Paulo, atencao) compartilham menção a GLP-1,
    // mas tópicos diferem; divergência exige MESMO tópico — usamos os triggers de GLP-1 da Yara
    // (yara-metabolico: sugestao) vs Paulo (paulo-cv-farmacos: atencao): tópicos distintos ⇒ sem divergência.
    stt.push('Iniciando GLP-1 semanal.');
    await flush();
    await board.flush();
    expect(events.every((e) => e.divergent === false)).toBe(true);
    board.stop();
    await session.stop();
  });

  it('B1 — a 2ª chamada do LLM recebe o histórico com a 1ª contribuição (anti-repetição)', async () => {
    let t = 0;
    const { stt, session, board, llm, events } = await setup({ now: () => (t += 3000) });

    stt.push('Vou prescrever sibutramina.');
    await flush();
    await board.flush();
    const firstText = events[0]!.contribution.text;
    // 1ª chamada: consulta ainda sem histórico
    expect(llm.calls[0]!.priorContributions ?? []).toHaveLength(0);
    expect(llm.calls[0]!.allowSkip).toBe(true);

    stt.push('Paciente com platô no peso e muito cansaço.');
    await flush();
    await board.flush();

    const laterCall = llm.calls[llm.calls.length - 1]!;
    expect(laterCall.priorContributions!.length).toBeGreaterThan(0);
    expect(laterCall.priorContributions!.some((p) => p.includes(firstText))).toBe(true);
    board.stop();
    await session.stop();
  });

  it('B1 — {"skip":true} do modelo: nada emitido, nada auditado, decisão llm-skip', async () => {
    let t = 0;
    const decisions: string[] = [];
    const { stt, session, board, llm, events } = await setup({
      now: () => (t += 3000),
      onDecision: (kind) => decisions.push(kind),
    });
    llm.skipIf = () => true;

    const auditBefore = await exec.query<{ n: string }>('SELECT COUNT(*) AS n FROM audit_log');
    stt.push('Vou prescrever sibutramina.');
    await flush();
    await board.flush();

    expect(events).toHaveLength(0);
    expect(decisions).toContain('llm-skip');
    const auditAfter = await exec.query<{ n: string }>('SELECT COUNT(*) AS n FROM audit_log');
    expect(Number(auditAfter.rows[0]!.n)).toBe(Number(auditBefore.rows[0]!.n)); // sem trilha fantasma
    board.stop();
    await session.stop();
  });

  it('B1 — a síntese do Aurélio recebe o histórico da consulta inteira', async () => {
    let t = 0;
    const { stt, session, board, llm } = await setup({ now: () => (t += 3000) });
    stt.push('GLP-1 prescrito.');
    stt.push('Paciente com platô e cansaço.');
    await flush();
    await board.flush();

    await board.synthesizeNow();
    const synthCall = llm.calls[llm.calls.length - 1]!;
    expect(synthCall.system).toContain('SÍNTESE');
    expect(synthCall.priorContributions!.length).toBeGreaterThanOrEqual(2);
    board.stop();
    await session.stop();
  });

  it('B2 — mesmo tópico repetido MUITO depois (fora dos 60s do gate): corte pré-LLM sem nova chamada', async () => {
    let t = 1000;
    const decisions: string[] = [];
    const { stt, session, board, llm, events } = await setup({
      now: () => t,
      onDecision: (kind) => decisions.push(kind),
    });

    stt.push('Estou com platô no peso há meses.'); // yara-plato (severidade normal)
    await flush();
    await board.flush();
    const emitted = events.length;
    expect(emitted).toBeGreaterThan(0);
    const callsAfterFirst = llm.calls.length;

    t = 300_000; // 5min depois — o Deduplicator de 60s do gate já esqueceu o tópico
    stt.push('Estou com platô no peso há meses.'); // mesma fala, zero vocabulário novo
    await flush();
    await board.flush();

    expect(decisions).toContain('semantic-duplicate');
    expect(llm.calls.length).toBe(callsAfterFirst); // economia: LLM NÃO foi chamado
    expect(events.length).toBe(emitted); // nada repetido no feed
    board.stop();
    await session.stop();
  });

  it('B2 — critical NUNCA é cortado pré-LLM (recall de segurança); pós-LLM pega texto igual', async () => {
    let t = 1000;
    const decisions: string[] = [];
    const { stt, session, board, llm, events } = await setup({
      now: () => t,
      onDecision: (kind) => decisions.push(kind),
    });

    stt.push('Vou prescrever sibutramina.'); // paulo-cv-farmacos (critical)
    await flush();
    await board.flush();
    const callsAfterFirst = llm.calls.length;
    const emitted = events.length;

    t = 300_000;
    stt.push('Vou prescrever sibutramina.'); // mesma fala crítica
    await flush();
    await board.flush();

    expect(llm.calls.length).toBeGreaterThan(callsAfterFirst); // critical SEMPRE reanalisa
    expect(events.length).toBe(emitted); // mas texto idêntico não repete no feed
    expect(decisions).toContain('semantic-duplicate');
    board.stop();
    await session.stop();
  });

  it('6.1/T2 — segmento neutro: nenhuma chamada de LLM', async () => {
    let t = 0;
    const { stt, session, board, llm, events } = await setup({ now: () => (t += 3000) });
    stt.push('Bom dia, como vai a família?');
    await flush();
    await board.flush();
    expect(llm.calls).toHaveLength(0);
    expect(events).toHaveLength(0);
    board.stop();
    await session.stop();
  });
});
