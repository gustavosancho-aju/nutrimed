'use client';

import { useEffect } from 'react';
import type { BoardServerMessage } from '@nutrimed/shared-types';
import { useBoardStore, toContributionItem } from './board-store';

/**
 * `useBoardStream` (Story 3.3 — frontend-spec §11.2): conecta ao WS do board
 * (3.2), parseia mensagens tipadas e empurra contribuições para o
 * `useBoardStore`. Reconexão com backoff curto; o dedup por id no store
 * garante que reenvio pós-reconexão não duplica (AC4).
 */

/** Superfície mínima de WebSocket (mockável em teste — jsdom não conecta). */
export interface BrowserSocketLike {
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: { data?: unknown }) => void): void;
}

export type BrowserSocketFactory = (url: string) => BrowserSocketLike;

export interface UseBoardStreamOptions {
  /** URL base do gateway (default: mesma origem, porta do gateway via env). */
  baseUrl?: string;
  token?: string;
  socketFactory?: BrowserSocketFactory;
  maxRetries?: number;
  retryDelayMs?: number;
}

export function useBoardStream(consultationId: string, opts: UseBoardStreamOptions = {}) {
  const addContribution = useBoardStore((s) => s.addContribution);

  useEffect(() => {
    const factory: BrowserSocketFactory =
      opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as BrowserSocketLike);
    const base = opts.baseUrl ?? process.env.NEXT_PUBLIC_BOARD_WS_URL ?? 'ws://localhost:3001';
    const url = `${base}/board?consultationId=${encodeURIComponent(consultationId)}${
      opts.token ? `&token=${encodeURIComponent(opts.token)}` : ''
    }`;
    const maxRetries = opts.maxRetries ?? 5;
    const retryDelayMs = opts.retryDelayMs ?? 1000;

    let socket: BrowserSocketLike | null = null;
    let retries = 0;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      socket = factory(url);
      socket.addEventListener('open', () => {
        retries = 0;
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as BoardServerMessage;
          const item = toContributionItem(message);
          if (item) addContribution(item);
        } catch {
          // mensagem malformada é ignorada — protocolo versionado (3.2)
        }
      });
      socket.addEventListener('close', () => {
        if (disposed || retries >= maxRetries) return;
        retries += 1;
        retryTimer = setTimeout(connect, retryDelayMs * retries);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [
    consultationId,
    addContribution,
    opts.baseUrl,
    opts.token,
    opts.socketFactory,
    opts.maxRetries,
    opts.retryDelayMs,
  ]);
}
