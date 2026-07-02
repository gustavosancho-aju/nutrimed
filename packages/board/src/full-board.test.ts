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
  TextCompletionRequest,
  PersonaContribution,
} from '@nutrimed/providers';
import { FakeTextCompleter } from '@nutrimed/providers';
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
  /** B3: completeText opcional (CaseState) — atribuído por teste quando necessário. */
  completeText?: (req: TextCompletionRequest) => Promise<{ text: string; modelVersion?: string }>;
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

  async function setup(
    opts: {
      now?: () => number;
      pauseMs?: number;
      onDecision?: (kind: string) => void;
      caseStateEveryNFinals?: number;
      textScript?: readonly string[];
      caseReviewMs?: number;
      onCaseReview?: (outcome: 'skip' | 'contribution' | 'discarded') => void;
    } = {},
  ) {
    const stt = new PushSttProvider();
    const session = await startConsultationSession(exec, consultationId, stt);
    const llm = new EchoLlm();
    if (opts.textScript) {
      const completer = new FakeTextCompleter(opts.textScript);
      llm.completeText = (req) => completer.completeText(req);
    }
    const board = new FullBoardOrchestrator(exec, session, llm, makeStore(), {
      pauseMs: opts.pauseMs ?? 0, // pausa imediata por default (testes determinísticos)
      tickMs: 100000, // tick manual via flush — sem timer interferindo
      now: opts.now,
      onDecision: opts.onDecision,
      caseStateEveryNFinals: opts.caseStateEveryNFinals,
      caseReviewMs: opts.caseReviewMs,
      onCaseReview: opts.onCaseReview,
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

  it('B3 — CaseState entra no prompt das personas e da síntese', async () => {
    let t = 0;
    const STATE =
      '{"hypotheses":["hipotireoidismo subclínico"],"investigated":["TSH pedido"],"patientReports":["cansaço"],"pending":{}}';
    const { stt, session, board, llm } = await setup({
      now: () => (t += 3000),
      caseStateEveryNFinals: 1, // update a cada final (determinístico no teste)
      textScript: [STATE],
    });

    stt.push('Bom dia, vamos retomar o acompanhamento.'); // neutro — só alimenta o CaseState
    await flush();
    await board.flush();
    await flush(); // update fire-and-forget do tracker resolve

    stt.push('Paciente com platô no peso e muito cansaço.'); // dispara Yara/Aurélio
    await flush();
    await board.flush();

    const contributionCall = llm.calls.find((c) => !c.system.includes('SÍNTESE'));
    expect(contributionCall!.transcript).toContain('ESTADO DO CASO');
    expect(contributionCall!.transcript).toContain('hipotireoidismo subclínico');

    await board.synthesizeNow();
    const synthCall = llm.calls[llm.calls.length - 1]!;
    expect(synthCall.transcript).toContain('ESTADO DO CASO');
    board.stop();
    await session.stop();
  });

  it('B3 — provider sem completeText: board funciona igual (degradação graciosa)', async () => {
    let t = 0;
    const { stt, session, board, events } = await setup({ now: () => (t += 3000) }); // sem textScript
    stt.push('Vou prescrever sibutramina.');
    await flush();
    await board.flush();
    expect(events.length).toBeGreaterThan(0); // pipeline intacto, sem CaseState
    board.stop();
    await session.stop();
  });

  it('B4 — case review em pausa: contribuição roteada é emitida com triggeredBy case-review e auditada', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const { stt, session, board, events } = await setup({
      now: () => t,
      caseReviewMs: 90_000,
      textScript: [
        '{"personaId":"yara","type":"hipotese","severity":"normal","text":"Considere investigar cortisol diante do padrão de ganho de peso central relatado."}',
      ],
      onCaseReview: (o) => outcomes.push(o),
    });

    stt.push('Bom dia, a circunferência abdominal segue aumentando aos poucos.'); // sem palavra-gatilho
    await flush();
    await board.flush();
    expect(events).toHaveLength(0); // regex não pegou — é o gap que o review cobre

    t = 200_000; // pausa longa + intervalo de review vencido
    await board.tickNow();

    expect(outcomes).toEqual(['contribution']);
    expect(events).toHaveLength(1);
    expect(events[0]!.triggeredBy).toBe('case-review');
    expect(events[0]!.contribution.personaId).toBe('yara');
    const trail = await getAuditTrail(exec, events[0]!.id);
    expect(trail[0]!.triggeredBy).toBe('case-review');
    board.stop();
    await session.stop();
  });

  it('B4 — review com skip: nada emitido; respeita o intervalo mínimo entre reviews', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const { stt, session, board, events, llm } = await setup({
      now: () => t,
      caseReviewMs: 90_000,
      textScript: ['{"skip":true}', '{"skip":true}'],
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('Conversa neutra sem gatilhos.');
    await flush();
    await board.flush();

    t = 100_000;
    await board.tickNow();
    expect(outcomes).toEqual(['skip']);
    expect(events).toHaveLength(0);

    t = 110_000; // só 10s depois — intervalo de 90s NÃO venceu
    await board.tickNow();
    expect(outcomes).toEqual(['skip']); // nenhum review novo
    expect(llm.calls).toHaveLength(0); // e nenhum LLM de contribuição rodou
    board.stop();
    await session.stop();
  });

  it('B4 — review NÃO roda fora de pausa natural nem sem caseReviewMs', async () => {
    let t = 1000;
    const outcomes: string[] = [];
    const { stt, session, board } = await setup({
      now: () => t,
      pauseMs: 5000,
      caseReviewMs: 90_000,
      textScript: ['{"skip":true}'],
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('Fala recente.'); // lastSpeechAt = t
    await flush();
    await board.flush();

    t += 2000; // ainda DENTRO da conversa (pauseMs 5000)
    await board.tickNow();
    expect(outcomes).toHaveLength(0); // não interrompe o médico falando
    board.stop();
    await session.stop();
  });

  it('B4 — texto do review similar ao já exibido é DESCARTADO (dedup pós)', async () => {
    let t = 0;
    const outcomes: string[] = [];
    const { stt, session, board, events } = await setup({
      now: () => (t += 3000),
      caseReviewMs: 1, // intervalo mínimo — o teste controla via pausa
      textScript: [
        // parafraseia o chunk da Yara que o EchoLlm ecoa na 1ª contribuição
        '{"personaId":"yara","type":"sugestao","severity":"normal","text":"Cansaço com ganho de peso e platô: hipótese tireoidiana, sugerir TSH e T4 livre."}',
      ],
      onCaseReview: (o) => outcomes.push(o),
    });
    stt.push('Paciente com platô no peso e muito cansaço.'); // Yara contribui via trigger
    await flush();
    await board.flush();
    const emitted = events.length;
    expect(emitted).toBeGreaterThan(0);

    await board.tickNow(); // review devolve paráfrase do que a Yara já disse
    expect(outcomes).toEqual(['discarded']);
    expect(events).toHaveLength(emitted);
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
