// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useBoardStream, type BrowserSocketLike } from './use-board-stream';
import { useBoardStore } from './board-store';

/** Socket fake controlável — emite open/message/close sob demanda. */
function makeFakeSocketFactory() {
  const sockets: Array<{
    listeners: Record<string, Array<(event: { data?: unknown }) => void>>;
    emit(type: string, event?: { data?: unknown }): void;
  }> = [];
  const factory = () => {
    const listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};
    const socket = {
      listeners,
      emit(type: string, event: { data?: unknown } = {}) {
        (listeners[type] ?? []).forEach((l) => l(event));
      },
    };
    sockets.push(socket);
    return {
      close: () => {},
      addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        (listeners[type] ??= []).push(listener);
      },
    } as BrowserSocketLike;
  };
  return { factory, sockets };
}

afterEach(cleanup);
beforeEach(() => {
  useBoardStore.getState().clear();
  vi.useRealTimers();
});

describe('useBoardStream (A3 — status do pipeline)', () => {
  it('mensagem status → pipeline.stt no store', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't' }));

    act(() => {
      sockets[0]!.emit('message', {
        data: JSON.stringify({ v: 1, type: 'status', stt: 'degraded', lastFinalAt: null, at: 1 }),
      });
    });
    expect(useBoardStore.getState().pipeline.stt).toBe('degraded');

    act(() => {
      sockets[0]!.emit('message', {
        data: JSON.stringify({ v: 1, type: 'status', stt: 'live', lastFinalAt: 9, at: 2 }),
      });
    });
    expect(useBoardStore.getState().pipeline.stt).toBe('live');
  });

  it('open/close → wsConnected reflete a conexão', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't', maxRetries: 3 }));

    act(() => sockets[0]!.emit('open'));
    expect(useBoardStore.getState().pipeline.wsConnected).toBe(true);

    act(() => sockets[0]!.emit('close'));
    expect(useBoardStore.getState().pipeline.wsConnected).toBe(false);
    expect(useBoardStore.getState().pipeline.wsGaveUp).toBe(false); // ainda vai tentar
  });

  it('reconexão esgotada → wsGaveUp (a UI pede recarga)', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFakeSocketFactory();
    renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't', maxRetries: 1, retryDelayMs: 1 }));

    act(() => sockets[0]!.emit('close')); // 1ª queda → agenda retry
    act(() => vi.advanceTimersByTime(10)); // reconecta (socket #2)
    act(() => sockets[1]!.emit('close')); // 2ª queda com retries esgotados
    expect(useBoardStore.getState().pipeline.wsGaveUp).toBe(true);
  });

  it('trocar de consulta reseta o store — a transcrição da anterior não vaza', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const first = renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't' }));
    act(() => {
      sockets[0]!.emit('message', {
        data: JSON.stringify({ v: 1, type: 'transcript', text: 'fala da consulta 1', isFinal: true, at: 1 }),
      });
    });
    expect(useBoardStore.getState().transcript.finals).toEqual(['fala da consulta 1']);
    first.unmount();

    // navegação SPA: módulo (e store) sobrevivem — nova consulta monta o hook
    renderHook(() => useBoardStream('c2', { socketFactory: factory, token: 't' }));
    expect(useBoardStore.getState().transcript.finals).toEqual([]);
    expect(useBoardStore.getState().contributions).toEqual([]);
    expect(useBoardStore.getState().boundConsultationId).toBe('c2');
  });

  it('remontar a MESMA consulta preserva o estado (StrictMode double-mount)', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const first = renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't' }));
    act(() => {
      sockets[0]!.emit('message', {
        data: JSON.stringify({ v: 1, type: 'transcript', text: 'fala viva', isFinal: true, at: 1 }),
      });
    });
    first.unmount();

    renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't' }));
    expect(useBoardStore.getState().transcript.finals).toEqual(['fala viva']);
  });

  it('transcript atualiza lastTranscriptAt (insumo do watchdog)', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    renderHook(() => useBoardStream('c1', { socketFactory: factory, token: 't' }));
    expect(useBoardStore.getState().pipeline.lastTranscriptAt).toBeNull();

    act(() => {
      sockets[0]!.emit('message', {
        data: JSON.stringify({ v: 1, type: 'transcript', text: 'olá', isFinal: false, at: 1 }),
      });
    });
    expect(useBoardStore.getState().pipeline.lastTranscriptAt).not.toBeNull();
  });
});
