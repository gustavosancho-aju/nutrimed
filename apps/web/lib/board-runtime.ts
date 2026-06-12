import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardGateway } from '@nutrimed/board-gateway';
import { FullBoardOrchestrator, type FullBoardEvent } from '@nutrimed/board';
import { startConsultationSession, type ConsultationSession } from '@nutrimed/session';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import { NamespacedKnowledgeStore, ingest, seedSources } from '@nutrimed/kb';
import { DeepgramSttProvider } from '@nutrimed/stt-deepgram';
import { FakeLlmProvider, type ISttProvider, type SttSession, type TranscriptSegment, type ILlmProvider } from '@nutrimed/providers';
import { CLINICAL_VOCABULARY } from '@nutrimed/domain';
import { TelemetryRegistry, type GateDecisionKind, type UiEventKind } from '@nutrimed/telemetry';
import { getDb } from './db';

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
}

const globalForBoard = globalThis as unknown as { __nutrimedBoard?: Promise<BoardRuntime> };

export const BOARD_WS_PORT = Number(process.env.BOARD_WS_PORT ?? 3001);

async function init(): Promise<BoardRuntime> {
  const db = await getDb();
  const gateway = new BoardGateway(db, { port: BOARD_WS_PORT });
  // E5: ingere a SEED real por persona (R8 — trocar pela curadoria = re-ingestão)
  const kb = new NamespacedKnowledgeStore();
  const seedPath = join(process.cwd(), '..', '..', 'docs', 'personas-knowledge-base-seed.md');
  ingest(kb, seedSources(readFileSync(seedPath, 'utf8')), 'seed-v1');
  return { gateway, kb, telemetry: new TelemetryRegistry(), active: new Map() };
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

/** Wiring comum de telemetria por consulta (E10). */
function telemetryHooks(runtime: BoardRuntime, consultationId: string) {
  const t = runtime.telemetry;
  return {
    onUsage: (u: { inputTokens: number; outputTokens: number }) =>
      t.llmUsage(consultationId, u.inputTokens, u.outputTokens),
    onDecision: (kind: string) => t.gateDecision(consultationId, kind as GateDecisionKind),
    onContributionLatency: (ms: number) => t.contributionLatency(consultationId, ms),
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
  });
  runtime.gateway.bind(consultationId, orchestrator);
  // transcrição ao vivo p/ o painel (texto via WS — áudio nunca passa aqui, §7)
  session.subscribe((event) => {
    if (event.type === 'segment') {
      if (event.segment.isFinal) runtime.telemetry.sttSegment(consultationId);
      runtime.gateway.broadcastTranscript(consultationId, event.segment.text, event.segment.isFinal);
    }
  });
  // histórico de contribuições da sessão (insumo da nota clínica — E9)
  const events: FullBoardEvent[] = [];
  orchestrator.subscribe((event) => events.push(event));
  orchestrator.start();
  runtime.active.set(consultationId, { session, orchestrator, events });
  return { llmLabel: label };
}

/** Síntese sob demanda (FR18). */
export async function requestSynthesis(consultationId: string): Promise<void> {
  const runtime = await getBoardRuntime();
  await runtime.active.get(consultationId)?.orchestrator.synthesizeNow();
}

/** Insumos da nota clínica (E9): transcript acumulado + contribuições do board. */
export async function getNoteInputs(consultationId: string): Promise<{
  finals: string[];
  contributions: FullBoardEvent['contribution'][];
} | null> {
  const runtime = await getBoardRuntime();
  const active = runtime.active.get(consultationId);
  if (!active) return null;
  return {
    finals: active.session.getSnapshot().finalSegments.map((s) => s.text),
    contributions: active.events.map((e) => e.contribution),
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
  runtime.gateway.registerAudioSink(consultationId, audio.sink);

  const stt = new DeepgramSttProvider({ apiKey: process.env.DEEPGRAM_API_KEY });
  const session = await startConsultationSession(db, consultationId, stt, {
    audio: audio.iterable,
    vocabularyBoost: CLINICAL_VOCABULARY,
  });
  const hooks = telemetryHooks(runtime, consultationId);
  runtime.telemetry.sessionStarted(consultationId);
  const { llm } = makeLlm(hooks.onUsage);
  const orchestrator = new FullBoardOrchestrator(db, session, llm, runtime.kb, {
    pauseMs: 2500,
    tickMs: 1000,
    synthesisQuietMs: 20_000,
    maxPerMinutePerDoctor: 2,
    onDecision: hooks.onDecision,
    onContributionLatency: hooks.onContributionLatency,
  });
  runtime.gateway.bind(consultationId, orchestrator);
  session.subscribe((event) => {
    if (event.type === 'segment') {
      if (event.segment.isFinal) runtime.telemetry.sttSegment(consultationId);
      runtime.gateway.broadcastTranscript(consultationId, event.segment.text, event.segment.isFinal);
    }
  });
  const events: FullBoardEvent[] = [];
  orchestrator.subscribe((event) => events.push(event));
  orchestrator.start();
  runtime.active.set(consultationId, { session, orchestrator, events });
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
