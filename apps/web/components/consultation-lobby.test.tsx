// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ConsultationLobby } from './consultation-lobby';
import { checkMicrophone, createAudioSource, type RecorderLike } from '@/lib/microphone';

afterEach(cleanup);

function fakeStream(): MediaStream {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track] } as unknown as MediaStream;
}

const okDevices = (stream = fakeStream()) => ({
  getUserMedia: vi.fn(async () => stream),
});
const deniedDevices = () => ({
  getUserMedia: vi.fn(async () => {
    throw new DOMException('denied', 'NotAllowedError');
  }),
});
const gateFetch = (status: number) =>
  vi.fn(async () => ({ status }) as Response) as unknown as typeof fetch;

function fakeRecorder(): RecorderLike {
  return {
    start: vi.fn(),
    stop: vi.fn(function (this: RecorderLike) {
      this.onstop?.();
    }),
    ondataavailable: null,
    onstop: null,
  };
}

describe('checkMicrophone (Story 2.2)', () => {
  it('sem mediaDevices → unavailable', async () => {
    expect((await checkMicrophone(undefined)).status).toBe('unavailable');
  });
  it('NotAllowedError → denied', async () => {
    expect((await checkMicrophone(deniedDevices())).status).toBe('denied');
  });
  it('sucesso → ok com o stream para reuso', async () => {
    const stream = fakeStream();
    const result = await checkMicrophone(okDevices(stream));
    expect(result.status).toBe('ok');
    expect(result.stream).toBe(stream);
  });
});

describe('<ConsultationLobby> — gating duplo (AC1/AC2/AC3)', () => {
  it('sem permissão de microfone: início bloqueado, instrução clara e retry (AC2)', async () => {
    render(
      <ConsultationLobby
        consultationId="c1"
        onStart={() => {}}
        mediaDevices={deniedDevices()}
        fetchImpl={gateFetch(200)}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('mic-step').getAttribute('data-status')).toBe('denied'),
    );
    expect(screen.getByText(/Permissão de microfone negada/)).toBeDefined();
    expect(screen.getByText('Tentar de novo')).toBeDefined();
    expect((screen.getByText('Iniciar consulta') as HTMLButtonElement).disabled).toBe(true);
  });

  it('mic OK mas servidor NEGA (403): início bloqueado — cliente nunca decide (AC3)', async () => {
    render(
      <ConsultationLobby
        consultationId="c1"
        onStart={() => {}}
        mediaDevices={okDevices()}
        fetchImpl={gateFetch(403)}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('gate-step').getAttribute('data-status')).toBe('blocked'),
    );
    expect(screen.getByText(/Sem consentimento de gravação/)).toBeDefined();
    expect((screen.getByText('Iniciar consulta') as HTMLButtonElement).disabled).toBe(true);
  });

  it('mic OK + servidor 200: inicia e entrega a fonte de áudio (AC3/AC4)', async () => {
    const onStart = vi.fn();
    render(
      <ConsultationLobby
        consultationId="c1"
        onStart={onStart}
        mediaDevices={okDevices()}
        recorderFactory={fakeRecorder}
        fetchImpl={gateFetch(200)}
      />,
    );
    const button = screen.getByText('Iniciar consulta') as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0]![0]).toHaveProperty('chunks');
    expect(onStart.mock.calls[0]![0]).toHaveProperty('stop');
  });

  it('retry de microfone repete a checagem (AC2)', async () => {
    const devices = deniedDevices();
    render(
      <ConsultationLobby
        consultationId="c1"
        onStart={() => {}}
        mediaDevices={devices}
        fetchImpl={gateFetch(200)}
      />,
    );
    await screen.findByText('Tentar de novo');
    fireEvent.click(screen.getByText('Tentar de novo'));
    await waitFor(() => expect(devices.getUserMedia).toHaveBeenCalledTimes(2));
  });
});

describe('createAudioSource — captura → chunks p/ o STT (AC4/AC5)', () => {
  it('entrega chunks do recorder como Uint8Array e para limpo', async () => {
    const stream = fakeStream();
    const recorder = fakeRecorder();
    const source = createAudioSource(stream, () => recorder);

    recorder.ondataavailable!({
      data: { arrayBuffer: async () => new Uint8Array([7, 8]).buffer } as Blob,
    });
    const iterator = source.chunks[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect([...(first.value as Uint8Array)]).toEqual([7, 8]);

    source.stop(); // AC5: para recorder e tracks
    expect(recorder.stop).toHaveBeenCalled();
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled();
    const done = await iterator.next();
    expect(done.done).toBe(true);
  });

  it('stop é idempotente', () => {
    const recorder = fakeRecorder();
    const source = createAudioSource(fakeStream(), () => recorder);
    source.stop();
    source.stop();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});
