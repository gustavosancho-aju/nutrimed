import type { SqlExecutor } from '@nutrimed/db';
import { assertCaptureAuthorized } from '@nutrimed/consent';
import type { ISttProvider, SttSession, TranscriptSegment } from '@nutrimed/providers';

/**
 * Consultation Session Service (Story 2.3) — estado canônico da transcrição
 * por sessão de consulta, em memória (ADR-005; runtime validado na POC E3).
 *
 * Consome o `SttSession` (AsyncIterable) do provider e acumula:
 * - segmentos FINAIS: imutáveis, acrescentados em ordem, sem duplicação;
 * - segmento PARCIAL corrente: provisório, substituído a cada emissão e
 *   descartado quando o final correspondente chega.
 *
 * UI (2.4) e motores (E3/E4) consomem via {@link ConsultationSession.subscribe}
 * e {@link ConsultationSession.getSnapshot} — nunca falam com o STT direto.
 *
 * Compliance: a sessão só inicia após o gate de consentimento do servidor
 * (Story 1.4) autorizar. O conteúdo do transcript é dado de saúde: este módulo
 * NÃO o loga nem persiste (persistência clínica é E9).
 */

export type SessionStatus = 'live' | 'degraded' | 'ended';

export interface SessionSnapshot {
  readonly consultationId: string;
  readonly status: SessionStatus;
  /** Segmentos finais acumulados, em ordem de chegada. */
  readonly finalSegments: readonly TranscriptSegment[];
  /** Parcial corrente (ponta provisória) ou null. */
  readonly partial: TranscriptSegment | null;
  /** Erro que levou a sessão a `degraded`, se houver. */
  readonly error: Error | null;
}

export type SessionEvent =
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'status'; status: SessionStatus; error?: Error };

export type SessionListener = (event: SessionEvent) => void;

export class ConsultationSession {
  private status: SessionStatus = 'live';
  private readonly finals: TranscriptSegment[] = [];
  private partial: TranscriptSegment | null = null;
  private error: Error | null = null;
  private readonly listeners = new Set<SessionListener>();
  private readonly consumeLoop: Promise<void>;

  constructor(
    readonly consultationId: string,
    private readonly stream: SttSession,
  ) {
    this.consumeLoop = this.consume();
  }

  /** Assina eventos da sessão. Retorna função de unsubscribe (sem vazar listeners — AC5). */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Leitura imutável do estado corrente (AC3). */
  getSnapshot(): SessionSnapshot {
    return {
      consultationId: this.consultationId,
      status: this.status,
      finalSegments: [...this.finals],
      partial: this.partial,
      error: this.error,
    };
  }

  /**
   * Encerra a sessão: fecha o stream do provider, finaliza o loop consumidor e
   * preserva o acumulado em memória (AC5).
   */
  async stop(): Promise<void> {
    if (this.status === 'ended') return;
    await this.stream.close();
    await this.consumeLoop;
    this.setStatus('ended');
    this.listeners.clear();
  }

  private async consume(): Promise<void> {
    try {
      for await (const segment of this.stream) {
        if (segment.isFinal) {
          // final consolida a ponta: acrescenta e limpa o parcial (AC2)
          this.finals.push(segment);
          this.partial = null;
        } else {
          this.partial = segment;
        }
        this.emit({ type: 'segment', segment });
      }
      // stream terminou naturalmente (ex.: close()) — status final é decidido por stop()
    } catch (err) {
      // erro do STT degrada, não derruba (AC6) — Story 2.6 consome este estado
      this.error = err instanceof Error ? err : new Error(String(err));
      this.setStatus('degraded', this.error);
    }
  }

  private setStatus(status: SessionStatus, error?: Error): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type: 'status', status, error });
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * Inicia uma sessão de consulta: verifica o GATE de consentimento no servidor
 * (Story 1.4 — lança `ConsentRequiredError` se não autorizado) e só então abre
 * o stream PT-BR do provider (AC4).
 */
export async function startConsultationSession(
  db: SqlExecutor,
  consultationId: string,
  stt: ISttProvider,
): Promise<ConsultationSession> {
  await assertCaptureAuthorized(db, consultationId);
  const stream = stt.openStream({ lang: 'pt-BR' });
  return new ConsultationSession(consultationId, stream);
}
