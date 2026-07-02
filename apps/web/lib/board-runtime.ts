import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardGateway } from '@nutrimed/board-gateway';
import { FullBoardOrchestrator, type FullBoardEvent } from '@nutrimed/board';
import { startConsultationSession, type ConsultationSession } from '@nutrimed/session';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import { NamespacedKnowledgeStore, ingest, seedSources } from '@nutrimed/kb';
import { DeepgramSttProvider } from '@nutrimed/stt-deepgram';
import { FakeLlmProvider, type ISttProvider, type SttSession, type TranscriptSegment, type ILlmProvider } from '@nutrimed/providers';
import { CLINICAL_VOCABULARY } from '@nutrimed/domain';
import { TelemetryRegistry, type GateDecisionKind, type UiEventKind, type CaseReviewOutcome } from '@nutrimed/telemetry';
import {
  saveSynthesis,
  saveTranscriptSegment,
  listTranscriptFinals,
  listSyntheses,
  auditTranscriptPersistStart,
} from '@nutrimed/clinical-notes';
import type { SqlExecutor } from '@nutrimed/db';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';

/**
 * Runtime do board no processo do Next (demo do walking skeleton — E3).
 *
 * O gateway WS (3.2) vive no MESMO processo do Next porque o PGlite de dev é
 * single-process. Em produção (DATABASE_URL/pg) o gateway pode ser processo
 * próprio — decisão formal de runtime é a Story 3.5/ADR-010.
 *
 * Demo: o STT é um provider ROTEIRIZADO (consulta simulada PT-BR com gatilho
 * CV) — o resto do caminho é 100% real: orchestrator (3.1) → Claude Haiku
 * (se ANTHROPIC_API_KEY) → auditoria (1.5) → WS (3.2) → feed (3.3).
 * O STT real (Deepgram/OpenAI — 2.1) entra no fluxo de microfone quando o
 * transporte de áudio navegador→servidor for ligado (POC 2.5 / E3 completo).
 */

interface BoardRuntime {
  gateway: BoardGateway;
  kb: NamespacedKnowledgeStore;
  telemetry: TelemetryRegistry;
  active: Map<string, { session: ConsultationSession; orchestrator: FullBoardOrchestrator; events: FullBoardEvent[] }>;
  /** Último final por consulta (diagnóstico A5 — "recebendo há Xs"). */
  lastFinalAt: Map<string, number>;
}

const globalForBoard = globalThis as unknown as {
  __nutrimedBoard?: Promise<BoardRuntime>;
  /** A6: handshake com o server.mjs (fora do bundle) — roteia upgrades /board e /audio. */
  __nutrimedBoardUpgrade?: (request: unknown, socket: unknown, head: unknown) => void;
};

export const BOARD_WS_PORT = Number(process.env.BOARD_WS_PORT ?? 3001);
/** A6: 'attached' = WS na MESMA porta do HTTP (custom server, 443 no Fly);
 *  'port' (default) = listener próprio na 3001 (dev local com `next dev`). */
const BOARD_WS_MODE = process.env.BOARD_WS_MODE === 'attached' ? 'attached' : 'port';

async function init(): Promise<BoardRuntime> {
  const db = await getDb();
  let gateway: BoardGateway;
  if (BOARD_WS_MODE === 'attached') {
    gateway = new BoardGateway(db, { detached: true });
    const g = gateway;
    globalForBoard.__nutrimedBoardUpgrade = (request, socket, head) =>
      g.handleUpgrade(
        request as Parameters<BoardGateway['handleUpgrade']>[0],
        socket as Parameters<BoardGateway['handleUpgrade']>[1],
        head as Parameters<BoardGateway['handleUpgrade']>[2],
      );
    // TRANSIÇÃO: a URL antiga (wss://...:3001) continua funcionando por 1-2
    // deploys — clientes com a página aberta não quebram. Remover depois.
    const { createServer } = await import('node:http');
    const legacy = createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain' });
      res.end('upgrade required');
    });
    legacy.on('upgrade', (request, socket, head) => g.handleUpgrade(request, socket, head));
    legacy.on('error', (error) => console.error('[board] listener legado 3001:', error));
    legacy.listen(BOARD_WS_PORT, '0.0.0.0');
  } else {
    gateway = new BoardGateway(db, { port: BOARD_WS_PORT });
  }
  // E5: ingere a SEED real por persona (R8 — trocar pela curadoria = re-ingestão)
  const kb = new NamespacedKnowledgeStore();
  // cwd varia: apps/web (next start) vs raiz do repo (vitest) — aceita ambos.
  const seedCandidates = [
    join(process.cwd(), '..', '..', 'docs', 'personas-knowledge-base-seed.md'),
    join(process.cwd(), 'docs', 'personas-knowledge-base-seed.md'),
  ];
  const seedPath = seedCandidates.find((p) => existsSync(p)) ?? seedCandidates[0]!;
  ingest(kb, seedSources(readFileSync(seedPath, 'utf8')), 'seed-v1');
  return { gateway, kb, telemetry: new TelemetryRegistry(), active: new Map(), lastFinalAt: new Map() };
}

export function getBoardRuntime(): Promise<BoardRuntime> {
  if (!globalForBoard.__nutrimedBoard) {
    globalForBoard.__nutrimedBoard = init();
  }
  return globalForBoard.__nutrimedBoard;
}

/** Roteiro da consulta simulada (PT-BR) — dispara Paulo (CV crítico), Yara
 * (tireoide/platô) e deixa pausa p/ a síntese automática do Aurélio (E6). */
const DEMO_SCRIPT: ReadonlyArray<{ segment: TranscriptSegment; delayMs: number }> = [
  { segment: { text: 'Bom dia! Vamos retomar seu acompanhamento.', isFinal: true }, delayMs: 1500 },
  {
    segment: {
      text: 'Você relata muito cansaço, sente frio e notou queda de cabelo, com platô no peso há dois meses.',
      isFinal: true,
    },
    delayMs: 4000,
  },
  {
    segment: {
      text: 'Estou pensando em iniciar semaglutida semanal, mas você mencionou palpitação nas escadas, certo?',
      isFinal: true,
    },
    delayMs: 8000,
  },
  { segment: { text: 'Vamos revisar também a rotina alimentar e o sono.', isFinal: true }, delayMs: 11_000 },
];

/** STT roteirizado: emite o script com timing realista (demo sem microfone). */
class ScriptedDemoStt implements ISttProvider {
  openStream(): SttSession {
    let closed = false;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        const start = Date.now();
        for (const { segment, delayMs } of DEMO_SCRIPT) {
          const wait = start + delayMs - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          if (closed) return;
          yield { ...segment, receivedAtMs: Date.now() };
        }
      },
      async close(): Promise<void> {
        closed = true;
      },
    };
  }
}

function makeLlm(onUsage?: (u: { inputTokens: number; outputTokens: number }) => void): {
  llm: ILlmProvider;
  label: string;
} {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      llm: new AnthropicLlmProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        personaId: 'aurelio', // fallback — o Reasoner define a persona por contribuição
        onUsage, // telemetria de custo (E10/NFR7)
      }),
      label: 'claude-haiku-4-5 (real)',
    };
  }
  return { llm: new FakeLlmProvider('paulo', 'atencao'), label: 'fake (sem ANTHROPIC_API_KEY)' };
}

/**
 * Persistência do histórico do board: toda SÍNTESE do Aurélio é gravada
 * (cifrada + auditada) no momento em que sai — sobrevive a restart/fim da
 * consulta. Fire-and-forget com log: falha de persistência não derruba o board.
 */
function persistSynthesisEvents(db: SqlExecutor, consultationId: string, event: FullBoardEvent): void {
  if (event.contribution.type !== 'sintese') return;
  saveSynthesis(db, consultationId, event.contribution.text, getEncryptionKey(), event.contribution.modelVersion).catch(
    (error) => console.error('[board] falha ao salvar síntese:', error),
  );
}

/**
 * Wiring comum sessão→gateway (A3): transcript ao vivo + STATUS do pipeline
 * (live/degraded/ended) visível ao cliente — degradação silenciosa do STT foi
 * uma das causas do incidente de produção. Rastreia lastFinalAt por consulta.
 */
function wireSessionBroadcast(
  runtime: BoardRuntime,
  consultationId: string,
  session: ConsultationSession,
  db: SqlExecutor,
): void {
  let lastFinalAt: number | null = null;
  // A4: cada final é persistido cifrado no ato (fila encadeada preserva a
  // ordem) — a nota clínica sobrevive a deploy/restart no meio da consulta
  // (incidente 23:52). O seq continua do máximo existente: reinício da mesma
  // consulta NUNCA colide nem apaga a fala anterior.
  let nextSeq: Promise<number> = db
    .query<{ max: number | null }>(
      'SELECT MAX(seq) AS max FROM transcript_segment WHERE consultation_id = $1',
      [consultationId],
    )
    .then((r) => (r.rows[0]?.max ?? -1) + 1)
    .catch(() => 0);
  const persistFinal = (text: string) => {
    nextSeq = nextSeq.then(async (seq) => {
      try {
        await saveTranscriptSegment(db, consultationId, seq, text, getEncryptionKey());
      } catch (error) {
        console.error('[board] falha ao persistir segmento:', error);
      }
      return seq + 1;
    });
  };
  auditTranscriptPersistStart(db, consultationId).catch((error) =>
    console.error('[board] falha ao auditar início da persistência:', error),
  );
  session.subscribe((event) => {
    if (event.type === 'segment') {
      if (event.segment.isFinal) {
        lastFinalAt = Date.now();
        runtime.lastFinalAt.set(consultationId, lastFinalAt);
        runtime.telemetry.sttSegment(consultationId);
        persistFinal(event.segment.text);
      }
      runtime.gateway.broadcastTranscript(consultationId, event.segment.text, event.segment.isFinal);
      return;
    }
    if (event.type === 'status') {
      runtime.gateway.broadcastStatus(consultationId, event.status, lastFinalAt);
    }
  });
  // prime: quem abrir o /board já sabe que o pipeline está vivo (replay no gateway)
  runtime.gateway.broadcastStatus(consultationId, 'live', null);
}

/** Wiring comum de telemetria por consulta (E10). */
function telemetryHooks(runtime: BoardRuntime, consultationId: string) {
  const t = runtime.telemetry;
  return {
    onUsage: (u: { inputTokens: number; outputTokens: number }) =>
      t.llmUsage(consultationId, u.inputTokens, u.outputTokens),
    onDecision: (kind: string) => t.gateDecision(consultationId, kind as GateDecisionKind),
    onContributionLatency: (ms: number) => t.contributionLatency(consultationId, ms),
    onCaseStateUpdate: () => t.caseStateUpdate(consultationId), // B3/B5
    onCaseReview: (outcome: CaseReviewOutcome) => t.caseReview(consultationId, outcome), // B4/B5
  };
}

/** Inicia a demo do BOARD COMPLETO (E6) — gate de consentimento incluso (1.4). */
export async function startDemoBoard(consultationId: string): Promise<{ llmLabel: string }> {
  const db = await getDb();
  const runtime = await getBoardRuntime();

  // reinício idempotente: encerra a demo anterior da mesma consulta
  const previous = runtime.active.get(consultationId);
  if (previous) {
    previous.orchestrator.stop();
    await previous.session.stop();
  }

  const session = await startConsultationSession(db, consultationId, new ScriptedDemoStt(), {
    vocabularyBoost: CLINICAL_VOCABULARY,
  });
  const hooks = telemetryHooks(runtime, consultationId);
  runtime.telemetry.sessionStarted(consultationId);
  const { llm, label } = makeLlm(hooks.onUsage);
  const orchestrator = new FullBoardOrchestrator(db, session, llm, runtime.kb, {
    pauseMs: 2500,
    tickMs: 1000,
    synthesisQuietMs: 10_000,
    maxPerMinutePerDoctor: 2,
    onDecision: hooks.onDecision,
    onContributionLatency: hooks.onContributionLatency,
    onCaseStateUpdate: hooks.onCaseStateUpdate, // B5
    onCaseReview: hooks.onCaseReview,
  });
  runtime.gateway.bind(consultationId, orchestrator);
  // transcrição ao vivo p/ o painel (texto via WS — áudio nunca passa aqui, §7)
  wireSessionBroadcast(runtime, consultationId, session, db);
  // histórico de contribuições da sessão (insumo da nota clínica — E9)
  const events: FullBoardEvent[] = [];
  orchestrator.subscribe((event) => {
    events.push(event);
    persistSynthesisEvents(db, consultationId, event); // histórico salvo (cifrado+auditado)
  });
  orchestrator.start();
  runtime.active.set(consultationId, { session, orchestrator, events });
  return { llmLabel: label };
}

/** Síntese sob demanda (FR18). */
export async function requestSynthesis(consultationId: string): Promise<void> {
  const runtime = await getBoardRuntime();
  await runtime.active.get(consultationId)?.orchestrator.synthesizeNow();
}

/**
 * Insumos da nota clínica (E9): transcript acumulado + contribuições do board.
 * A4: o banco é a fonte durável — sessão ativa usa o superset (banco pode
 * conter fala de ANTES de um reinício da mesma consulta); sem sessão ativa
 * (pós-restart/deploy — o incidente das 23:52), cai integralmente no banco.
 */
export async function getNoteInputs(consultationId: string): Promise<{
  finals: string[];
  contributions: FullBoardEvent['contribution'][];
} | null> {
  const runtime = await getBoardRuntime();
  const db = await getDb();
  const key = getEncryptionKey();
  const dbFinals = await listTranscriptFinals(db, consultationId, key);

  const active = runtime.active.get(consultationId);
  if (active) {
    const memFinals = active.session.getSnapshot().finalSegments.map((s) => s.text);
    return {
      finals: dbFinals.length >= memFinals.length ? dbFinals : memFinals,
      contributions: active.events.map((e) => e.contribution),
    };
  }

  // pós-restart: transcript do banco + sínteses persistidas como contribuições
  const syntheses = await listSyntheses(db, consultationId, key);
  if (dbFinals.length === 0 && syntheses.length === 0) return null;
  return {
    finals: dbFinals,
    contributions: syntheses.map((s) => ({
      personaId: 'aurelio' as const,
      type: 'sintese' as const,
      severity: 'normal' as const,
      text: s.content,
      modelVersion: s.modelVersion ?? undefined,
    })),
  };
}

/** Snapshot do pipeline para o modo diagnóstico (A5). Só booleanos/contadores
 * — NUNCA valores de secrets nem conteúdo clínico. */
export interface PipelineStatusReport {
  readonly active: boolean;
  readonly sttStatus: 'idle' | 'live' | 'degraded' | 'ended';
  readonly finalsCount: number;
  readonly lastFinalAgoMs: number | null;
  readonly audioSinkRegistered: boolean;
  readonly boardClients: number;
  readonly deepgramConfigured: boolean;
  readonly anthropicConfigured: boolean;
  readonly persistedFinals: number;
}

export async function getPipelineStatus(consultationId: string): Promise<PipelineStatusReport> {
  const runtime = await getBoardRuntime();
  const db = await getDb();
  const active = runtime.active.get(consultationId);
  const lastFinalAt = runtime.lastFinalAt.get(consultationId) ?? null;
  const persisted = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) AS count FROM transcript_segment WHERE consultation_id = $1',
    [consultationId],
  );
  return {
    active: Boolean(active),
    sttStatus: active ? active.session.getSnapshot().status : 'idle',
    finalsCount: active ? active.session.getSnapshot().finalSegments.length : 0,
    lastFinalAgoMs: lastFinalAt ? Date.now() - lastFinalAt : null,
    audioSinkRegistered: runtime.gateway.hasAudioSink(consultationId),
    boardClients: runtime.gateway.clientCount(consultationId),
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    persistedFinals: Number(persisted.rows[0]?.count ?? 0),
  };
}

/** Fila de áudio: o WS /audio empurra; o adapter STT consome (AsyncIterable). */
function createAudioQueue() {
  const queue: Array<Uint8Array | null> = [];
  let wake: (() => void) | null = null;
  const push = (item: Uint8Array | null) => {
    queue.push(item);
    wake?.();
    wake = null;
  };
  const iterable: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        if (item === null) return;
        yield item;
      }
    },
  };
  return {
    iterable,
    sink: { push: (chunk: Uint8Array) => push(chunk), end: () => push(null) },
  };
}

/**
 * CONSULTA AO VIVO (mic real): áudio do navegador chega pelo WS /audio do
 * gateway → fila → DeepgramSttProvider (streaming PT-BR + boost clínico) →
 * sessão (2.3) → board completo (E6). A key do vendor NUNCA vai ao browser.
 */
export async function startLiveBoard(consultationId: string): Promise<void> {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error('DEEPGRAM_API_KEY ausente — configure o STT para a consulta ao vivo.');
  }
  const db = await getDb();
  const runtime = await getBoardRuntime();

  const previous = runtime.active.get(consultationId);
  if (previous) {
    previous.orchestrator.stop();
    await previous.session.stop();
    runtime.gateway.unregisterAudioSink(consultationId);
  }

  const audio = createAudioQueue();
  let session: ConsultationSession | undefined;
  let orchestrator: FullBoardOrchestrator | undefined;
  try {
    // O gate de consentimento (FR20) roda AQUI — antes de qualquer sink existir.
    // O client só conecta o WS /audio depois que esta action retorna, então
    // registrar o sink após a sessão não perde áudio e elimina o sink órfão.
    const stt = new DeepgramSttProvider({ apiKey: process.env.DEEPGRAM_API_KEY });
    session = await startConsultationSession(db, consultationId, stt, {
      audio: audio.iterable,
      vocabularyBoost: CLINICAL_VOCABULARY,
    });
    runtime.gateway.registerAudioSink(consultationId, audio.sink);
    const hooks = telemetryHooks(runtime, consultationId);
    runtime.telemetry.sessionStarted(consultationId);
    const { llm } = makeLlm(hooks.onUsage);
    orchestrator = new FullBoardOrchestrator(db, session, llm, runtime.kb, {
      pauseMs: 2500,
      tickMs: 1000,
      synthesisQuietMs: 20_000,
      maxPerMinutePerDoctor: 2,
      onDecision: hooks.onDecision,
      onContributionLatency: hooks.onContributionLatency,
      caseReviewMs: 90_000, // B4: análise periódica do caso (piloto) — só em pausa natural
      onCaseStateUpdate: hooks.onCaseStateUpdate,
      onCaseReview: hooks.onCaseReview,
    });
    runtime.gateway.bind(consultationId, orchestrator);
    wireSessionBroadcast(runtime, consultationId, session, db);
    const events: FullBoardEvent[] = [];
    orchestrator.subscribe((event) => {
      events.push(event);
      persistSynthesisEvents(db, consultationId, event); // histórico salvo (cifrado+auditado)
    });
    orchestrator.start();
    runtime.active.set(consultationId, { session, orchestrator, events });
  } catch (error) {
    // rollback completo: nada fica órfão (sink, sessão STT ou orchestrator)
    runtime.gateway.unregisterAudioSink(consultationId);
    orchestrator?.stop();
    await session?.stop().catch(() => {});
    throw error;
  }
}

/** Encerra a consulta ao vivo (para STT e board; preserva transcript p/ a nota). */
export async function stopLiveBoard(consultationId: string): Promise<void> {
  const runtime = await getBoardRuntime();
  runtime.gateway.unregisterAudioSink(consultationId);
  const active = runtime.active.get(consultationId);
  if (active) {
    active.orchestrator.stop();
    await active.session.stop();
  }
  runtime.telemetry.sessionEnded(consultationId);
}

/** Relatório de telemetria da consulta + sumário da instância (E10). */
export async function getTelemetryReport(consultationId: string) {
  const runtime = await getBoardRuntime();
  return { report: runtime.telemetry.report(consultationId), summary: runtime.telemetry.summary() };
}

export async function recordUiEvent(consultationId: string, kind: UiEventKind): Promise<void> {
  const runtime = await getBoardRuntime();
  runtime.telemetry.uiEvent(consultationId, kind);
}
