import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '@nutrimed/providers';
import {
  OpenAiSttProvider,
  OpenAiSttError,
  openAiSttConfigFromEnv,
  buildSessionUpdate,
  type WebSocketLike,
  type WsEventLike,
} from './openai';

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closedWith: { code?: number } | null = null;
  private listeners = new Map<string, Array<(e: WsEventLike) => void>>();

  send(data: string | ArrayBufferLike | Uint8Array): void {
    this.sent.push(String(data));
  }
  close(code?: number): void {
    this.closedWith = { code };
  }
  addEventListener(type: string, listener: (e: WsEventLike) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(type: string, event: WsEventLike = {}): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
  event(payload: object): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

function makeProvider(socket: FakeSocket, protocolsSink?: { protocols?: string[] }) {
  return new OpenAiSttProvider({
    apiKey: 'sk-test',
    now: () => 42,
    socketFactory: (_url, protocols) => {
      if (protocolsSink) protocolsSink.protocols = protocols;
      return socket;
    },
  });
}

async function collect(iterable: AsyncIterable<TranscriptSegment>, n: number) {
  const out: TranscriptSegment[] = [];
  for await (const s of iterable) {
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

describe('OpenAiSttProvider (2º candidato — POC 2.5)', () => {
  it('deltas acumulam como parciais; completed vira final e zera o parcial', async () => {
    const socket = new FakeSocket();
    const session = makeProvider(socket).openStream({ lang: 'pt-BR' });

    socket.event({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Paciente ' });
    socket.event({ type: 'conversation.item.input_audio_transcription.delta', delta: 'em GLP-1' });
    socket.event({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Paciente em GLP-1 com cansaço.',
    });

    const [p1, p2, final] = await collect(session, 3);
    expect(p1).toMatchObject({ text: 'Paciente ', isFinal: false, receivedAtMs: 42 });
    expect(p2).toMatchObject({ text: 'Paciente em GLP-1', isFinal: false });
    expect(final).toMatchObject({ text: 'Paciente em GLP-1 com cansaço.', isFinal: true });
    await session.close();
  });

  it('configura a sessão no open: PT + prompt com termos clínicos (sem keyword boost)', () => {
    const socket = new FakeSocket();
    makeProvider(socket).openStream({ lang: 'pt-BR', vocabularyBoost: ['semaglutida', 'TSH'] });
    socket.emit('open');

    const update = JSON.parse(socket.sent[0]!) as ReturnType<typeof buildSessionUpdate> & {
      session: { input_audio_transcription: { language: string; prompt: string } };
    };
    expect(update).toMatchObject({ type: 'transcription_session.update' });
    expect(update.session.input_audio_transcription.language).toBe('pt');
    expect(update.session.input_audio_transcription.prompt).toContain('semaglutida');
  });

  it('autentica via subprotocolos realtime (sem header custom)', () => {
    const sink: { protocols?: string[] } = {};
    makeProvider(new FakeSocket(), sink).openStream({ lang: 'pt-BR' });
    expect(sink.protocols).toEqual([
      'realtime',
      'openai-insecure-api-key.sk-test',
      'openai-beta.realtime-v1',
    ]);
  });

  it('áudio é enviado como input_audio_buffer.append em base64 + commit no fim', async () => {
    const socket = new FakeSocket();
    async function* audio() {
      yield new Uint8Array([1, 2, 3]);
    }
    makeProvider(socket).openStream({ lang: 'pt-BR', audio: audio() });
    socket.emit('open');
    await new Promise((r) => setTimeout(r, 0));

    const append = JSON.parse(socket.sent[1]!) as { type: string; audio: string };
    expect(append.type).toBe('input_audio_buffer.append');
    expect(Buffer.from(append.audio, 'base64')).toEqual(Buffer.from([1, 2, 3]));
    expect(JSON.parse(socket.sent[2]!)).toMatchObject({ type: 'input_audio_buffer.commit' });
  });

  it('evento error do servidor e close ≠1000 viram OpenAiSttError', async () => {
    const s1 = new FakeSocket();
    const session1 = makeProvider(s1).openStream({ lang: 'pt-BR' });
    s1.event({ type: 'error', error: { message: 'rate limit' } });
    await expect(collect(session1, 1)).rejects.toThrow(/rate limit/);

    const s2 = new FakeSocket();
    const session2 = makeProvider(s2).openStream({ lang: 'pt-BR' });
    s2.emit('close', { code: 1011 });
    await expect(collect(session2, 1)).rejects.toBeInstanceOf(OpenAiSttError);
  });

  it('credencial ausente/vazia gera erro claro de config', () => {
    expect(() => openAiSttConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(/OPENAI_API_KEY/);
    expect(() => new OpenAiSttProvider({ apiKey: '' })).toThrow(OpenAiSttError);
  });
});
