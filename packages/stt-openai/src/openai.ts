import type {
  ISttProvider,
  SttSession,
  SttOpenOptions,
  TranscriptSegment,
} from '@nutrimed/providers';

/**
 * Adapter OpenAI Realtime (gpt-4o-transcribe) para `ISttProvider` — 2º candidato
 * da POC 2.5 (Story 2.1/2.5 — NFR8: vendor é detalhe trocável).
 *
 * WebSocket nativo (sem SDK): `wss://api.openai.com/v1/realtime?intent=transcription`,
 * auth via subprotocolos (`openai-insecure-api-key.<KEY>` — caminho documentado p/
 * WS sem headers). Diferenças honestas vs Deepgram, relevantes p/ a POC:
 * - parciais chegam como DELTAS (`...transcription.delta`) — acumulamos no parcial;
 * - finais em `...transcription.completed`;
 * - SEM boost determinístico de termos: `vocabularyBoost` vira `prompt` (dica ao
 *   modelo), menos garantido que `keywords` do Deepgram — medir na POC (T4);
 * - SEM timestamps de áudio por segmento: só `receivedAtMs` (latência fala→texto
 *   na POC precisa do relógio do harness).
 */

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

export interface WsEventLike {
  readonly data?: unknown;
  readonly code?: number;
}

export interface WebSocketLike {
  send(data: string | ArrayBufferLike | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: WsEventLike) => void,
  ): void;
}

export interface OpenAiSttConfig {
  readonly apiKey: string;
  readonly endpoint?: string;
  /** Modelo de transcrição (default gpt-4o-mini-transcribe — mais barato p/ POC). */
  readonly model?: string;
  readonly socketFactory?: WebSocketFactory;
  readonly now?: () => number;
}

export class OpenAiSttError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'connection' | 'protocol',
  ) {
    super(message);
    this.name = 'OpenAiSttError';
  }
}

const DEFAULT_ENDPOINT = 'wss://api.openai.com/v1/realtime?intent=transcription';

export function openAiSttConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAiSttConfig {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OpenAiSttError(
      'OPENAI_API_KEY ausente — configure a credencial do STT no ambiente (.env).',
      'config',
    );
  }
  return { apiKey };
}

export class OpenAiSttProvider implements ISttProvider {
  constructor(private readonly config: OpenAiSttConfig) {
    if (!config.apiKey) {
      throw new OpenAiSttError('apiKey vazia — credencial da OpenAI é obrigatória.', 'config');
    }
  }

  openStream(opts: SttOpenOptions): SttSession {
    const factory: WebSocketFactory =
      this.config.socketFactory ??
      ((u, protocols) => new WebSocket(u, protocols) as unknown as WebSocketLike);
    const socket = factory(this.config.endpoint ?? DEFAULT_ENDPOINT, [
      'realtime',
      `openai-insecure-api-key.${this.config.apiKey}`,
      'openai-beta.realtime-v1',
    ]);
    return new OpenAiSession(
      socket,
      opts,
      this.config.model ?? 'gpt-4o-mini-transcribe',
      this.config.now ?? Date.now,
    );
  }
}

/** Constrói o evento de configuração da sessão de transcrição (PT-BR + prompt de termos). */
export function buildSessionUpdate(opts: SttOpenOptions, model: string): object {
  return {
    type: 'transcription_session.update',
    session: {
      input_audio_transcription: {
        model,
        language: 'pt', // NFR11 — PT (BR) na Realtime API
        // sem keyword boost na OpenAI: termos viram dica de prompt (medir na POC — T4)
        prompt: opts.vocabularyBoost?.length
          ? `Transcrição de consulta médica em português do Brasil. Termos esperados: ${opts.vocabularyBoost.join(', ')}.`
          : 'Transcrição de consulta médica em português do Brasil.',
      },
    },
  };
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
}

class OpenAiSession implements SttSession {
  private readonly queue: Array<TranscriptSegment | Error | null> = [];
  private wake: (() => void) | null = null;
  private closed = false;
  /** Deltas acumulados do item corrente → parcial. */
  private pending = '';

  constructor(
    private readonly socket: WebSocketLike,
    opts: SttOpenOptions,
    model: string,
    private readonly now: () => number,
  ) {
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(buildSessionUpdate(opts, model)));
      if (opts.audio) void this.pumpAudio(opts.audio);
    });
    socket.addEventListener('message', (event) => this.onMessage(event.data));
    socket.addEventListener('error', () => {
      this.push(new OpenAiSttError('Falha na conexão com o STT (OpenAI Realtime).', 'connection'));
    });
    socket.addEventListener('close', (event) => {
      if (event.code === 1000 || this.closed) this.push(null);
      else
        this.push(
          new OpenAiSttError(`Conexão STT encerrada inesperadamente (code ${event.code}).`, 'connection'),
        );
    });
  }

  private async pumpAudio(audio: AsyncIterable<Uint8Array>): Promise<void> {
    try {
      for await (const chunk of audio) {
        if (this.closed) return;
        this.socket.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: Buffer.from(chunk).toString('base64'),
          }),
        );
      }
      this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    } catch (err) {
      this.push(
        new OpenAiSttError(
          `Fonte de áudio falhou: ${err instanceof Error ? err.message : String(err)}`,
          'protocol',
        ),
      );
    }
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: RealtimeEvent;
    try {
      msg = JSON.parse(data) as RealtimeEvent;
    } catch {
      this.push(new OpenAiSttError('Mensagem inválida do STT (JSON malformado).', 'protocol'));
      return;
    }
    switch (msg.type) {
      case 'conversation.item.input_audio_transcription.delta': {
        this.pending += msg.delta ?? '';
        if (this.pending !== '') {
          this.push({ text: this.pending, isFinal: false, receivedAtMs: this.now() });
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = msg.transcript ?? this.pending;
        this.pending = '';
        if (text !== '') this.push({ text, isFinal: true, receivedAtMs: this.now() });
        break;
      }
      case 'error': {
        this.push(
          new OpenAiSttError(msg.error?.message ?? 'Erro do servidor Realtime.', 'protocol'),
        );
        break;
      }
      default:
        break; // session.created, rate_limits etc. são ignorados
    }
  }

  private push(item: TranscriptSegment | Error | null): void {
    this.queue.push(item);
    this.wake?.();
    this.wake = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
    for (;;) {
      const item = this.queue.shift();
      if (item === undefined) {
        if (this.closed) return;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      if (item === null) return;
      if (item instanceof Error) throw item;
      yield item;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.close(1000, 'client closed');
    this.push(null);
  }
}
