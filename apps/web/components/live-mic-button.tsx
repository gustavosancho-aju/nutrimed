'use client';

import { useCallback, useRef, useState } from 'react';
import { startLiveBoardAction, stopLiveBoardAction } from '@/lib/board-actions';
import { checkMicrophone, createAudioSource, type AudioSource } from '@/lib/microphone';

/**
 * Consulta AO VIVO com microfone real (E3 final / Story 2.2 REUSE).
 *
 * Fluxo: (1) server action arma o pipeline (sink de áudio + Deepgram + board);
 * (2) checagem/captura do microfone no navegador (2.2); (3) chunks vão por um
 * WS dedicado `/audio` ao NOSSO servidor — a key do STT nunca toca o browser.
 * O gate de consentimento (1.4) é exigido pelo servidor ao criar a sessão.
 */

type LiveState = 'idle' | 'starting' | 'live' | 'error';

export function LiveMicButton({
  consultationId,
  token,
  wsBaseUrl,
}: {
  consultationId: string;
  token: string;
  wsBaseUrl: string;
}) {
  const [state, setState] = useState<LiveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const stop = useCallback(async () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setState('idle');
    await stopLiveBoardAction(consultationId).catch(() => {});
  }, [consultationId]);

  const start = useCallback(async () => {
    setState('starting');
    setError(null);
    try {
      // 1) servidor arma o pipeline (Deepgram + sessão + board) — gate 1.4 incluso
      await startLiveBoardAction(consultationId);

      // 2) microfone (Story 2.2 — pede permissão 1x e reusa o stream)
      const mic = await checkMicrophone(navigator.mediaDevices);
      if (mic.status !== 'ok' || !mic.stream) {
        setError(
          mic.status === 'denied'
            ? 'Permissão de microfone negada — libere no cadeado da barra de endereço e tente de novo.'
            : 'Nenhum microfone disponível.',
        );
        setState('error');
        await stopLiveBoardAction(consultationId).catch(() => {});
        return;
      }

      // 3) captura → WS /audio (só áudio binário; eventos do board vão no /board)
      const source: AudioSource = createAudioSource(mic.stream);
      const ws = new WebSocket(
        `${wsBaseUrl}/audio?consultationId=${encodeURIComponent(consultationId)}&token=${encodeURIComponent(token)}`,
      );
      ws.binaryType = 'arraybuffer';

      let pumping = true;
      ws.onopen = () => {
        void (async () => {
          for await (const chunk of source.chunks) {
            if (!pumping || ws.readyState !== WebSocket.OPEN) break;
            ws.send(chunk);
          }
        })();
        setState('live');
      };
      ws.onerror = () => {
        setError('Falha no canal de áudio.');
        setState('error');
      };
      ws.onclose = () => {
        pumping = false;
      };

      cleanupRef.current = () => {
        pumping = false;
        source.stop();
        ws.close();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar a consulta ao vivo.');
      setState('error');
    }
  }, [consultationId, token, wsBaseUrl]);

  return (
    <div className="flex flex-col items-end gap-1">
      {state === 'live' ? (
        <button
          type="button"
          onClick={() => void stop()}
          className="rounded-md bg-attn-critical px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          ⏹ Encerrar (ao vivo)
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={state === 'starting'}
          className="rounded-md border border-brand px-3 py-2 text-xs font-semibold text-brand hover:bg-surface-muted disabled:opacity-50"
        >
          {state === 'starting' ? '… preparando' : '🎙️ Consulta ao vivo'}
        </button>
      )}
      {error ? <p className="max-w-[220px] text-right text-[10px] text-red-700">{error}</p> : null}
    </div>
  );
}
