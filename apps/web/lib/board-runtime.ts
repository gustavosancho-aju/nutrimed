import 'server-only';
import { BoardGateway } from '@nutrimed/board-gateway';
import { BoardOrchestrator } from '@nutrimed/board';
import { startConsultationSession, type ConsultationSession } from '@nutrimed/session';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import { FakeLlmProvider, type ISttProvider, type SttSession, type TranscriptSegment, type ILlmProvider } from '@nutrimed/providers';
import { CLINICAL_VOCABULARY } from '@nutrimed/domain';
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
  active: Map<string, { session: ConsultationSession; orchestrator: BoardOrchestrator }>;
}

const globalForBoard = globalThis as unknown as { __nutrimedBoard?: Promise<BoardRuntime> };

export const BOARD_WS_PORT = Number(process.env.BOARD_WS_PORT ?? 3001);

async function init(): Promise<BoardRuntime> {
  const db = await getDb();
  const gateway = new BoardGateway(db, { port: BOARD_WS_PORT });
  return { gateway, active: new Map() };
}

export function getBoardRuntime(): Promise<BoardRuntime> {
  if (!globalForBoard.__nutrimedBoard) {
    globalForBoard.__nutrimedBoard = init();
  }
  return globalForBoard.__nutrimedBoard;
}

/** Roteiro da consulta simulada (PT-BR) — o 3º segmento dispara o gatilho CV do Paulo. */
const DEMO_SCRIPT: ReadonlyArray<{ segment: TranscriptSegment; delayMs: number }> = [
  { segment: { text: 'Bom dia! Vamos retomar seu acompanhamento.', isFinal: true }, delayMs: 1500 },
  { segment: { text: 'Vi que o peso estabilizou nas últimas quatro semanas.', isFinal: true }, delayMs: 3500 },
  {
    segment: {
      text: 'Estou pensando em iniciar semaglutida semanal, mas você mencionou palpitação nas escadas, certo?',
      isFinal: true,
    },
    delayMs: 6000,
  },
  { segment: { text: 'Vamos também revisar a rotina de sono e o treino de força.', isFinal: true }, delayMs: 9000 },
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

function makeLlm(): { llm: ILlmProvider; label: string } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      llm: new AnthropicLlmProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        personaId: 'paulo',
      }),
      label: 'claude-haiku-4-5 (real)',
    };
  }
  return { llm: new FakeLlmProvider('paulo', 'atencao'), label: 'fake (sem ANTHROPIC_API_KEY)' };
}

/** Inicia a demo do board para a consulta (gate de consentimento incluso — 1.4). */
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
  const { llm, label } = makeLlm();
  const orchestrator = new BoardOrchestrator(db, session, llm, { cooldownMs: 30_000 });
  runtime.gateway.bind(consultationId, orchestrator);
  orchestrator.start();
  runtime.active.set(consultationId, { session, orchestrator });
  return { llmLabel: label };
}
