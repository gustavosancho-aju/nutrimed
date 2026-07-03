import { describe, it, expect, vi } from 'vitest';
import { pickRecorderMime, createAudioSource, type RecorderLike } from './microphone';

/** A2 — escolha do mimeType do MediaRecorder por suporte do navegador. */
describe('pickRecorderMime', () => {
  it('Chrome/Edge: prefere audio/webm;codecs=opus', () => {
    const result = pickRecorderMime((t) => t.startsWith('audio/webm'));
    expect(result).toEqual({ supported: true, mimeType: 'audio/webm;codecs=opus' });
  });

  it('Firefox sem o alias com codecs: cai para audio/webm', () => {
    const result = pickRecorderMime((t) => t === 'audio/webm' || t === 'audio/ogg;codecs=opus');
    expect(result).toEqual({ supported: true, mimeType: 'audio/webm' });
  });

  it('só Ogg/Opus: usa audio/ogg;codecs=opus', () => {
    const result = pickRecorderMime((t) => t === 'audio/ogg;codecs=opus');
    expect(result).toEqual({ supported: true, mimeType: 'audio/ogg;codecs=opus' });
  });

  it('Safari/iOS (só mp4/AAC): nenhum formato compatível', () => {
    const result = pickRecorderMime((t) => t === 'audio/mp4');
    expect(result).toEqual({ supported: false });
  });

  it('ambiente sem MediaRecorder (default): não explode e reporta incompatível', () => {
    expect(pickRecorderMime()).toEqual({ supported: false });
  });
});

describe('createAudioSource (A2 — mimeType chega ao recorder)', () => {
  it('repassa o mimeType escolhido à factory do recorder', () => {
    const factory = vi.fn(
      (): RecorderLike => ({ start: () => {}, stop: () => {}, ondataavailable: null, onstop: null }),
    );
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const source = createAudioSource(stream, factory, 250, 'audio/webm;codecs=opus');
    expect(factory).toHaveBeenCalledWith(stream, 'audio/webm;codecs=opus');
    source.stop();
  });
});
