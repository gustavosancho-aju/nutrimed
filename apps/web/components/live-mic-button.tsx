'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startLiveBoardAction, stopLiveBoardAction } from '@/lib/board-actions';
import { ACTION_ERROR_MESSAGES } from '@/lib/action-result';
import { checkMicrophone, createAudioSource, pickRecorderMime, type AudioSource } from '@/lib/microphone';
import { useBoardStore } from '@/lib/board-store';
import { isTranscriptSilent } from '@/lib/pipeline-watchdog';

/**
 * Consulta AO VIVO com microfone real (E3 final / Story 2.2 REUSE).
 *
 * Fluxo: (1) server action arma o pipeline (sink de áudio + Deepgram + board);
 * (2) checagem/captura do microfone no navegador (2.2); (3) chunks vão por um
 * WS dedicado `/audio` ao NOSSO servidor — a key do STT nunca toca o browser.
 * O gate de consentimento (1.4) é exigido pelo servidor ao criar a sessão.
 */

type LiveState = 'idle' | 'starting' | 'live' | 'error' | 'stale-deploy';

/** Deploy no meio da sessão: a referência da server action ficou órfã no cliente. */
function isStaleDeployError(err: unknown): boolean {
  return err instanceof Error && /Server Action|Failed to find/i.test(err.message);
}

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
  const [warning, setWarning] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Watchdog (A3): "ao vivo" mas NENHUM transcript (nem parcial) em 10s —
  // era exatamente a falha silenciosa que o médico viu em produção.
  useEffect(() => {
    if (state !== 'live') {
      setWarning(null);
      return;
    }
    const liveSince = Date.now();
    const timer = setInterval(() => {
      const last = useBoardStore.getState().pipeline.lastTranscriptAt;
      if (isTranscriptSilent(liveSince, last, Date.now())) {
        setWarning(
          'Ao vivo há 10s sem nenhuma fala transcrita — fale mais perto do microfone ou abra o Diagnóstico.',
        );
      } else if (last && last >= liveSince) {
        setWarning(null);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [state]);

  const stop = useCallback(async () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setState('idle');
    await stopLiveBoardAction(consultationId).catch(() => {});
  }, [consultationId]);

  const start = useCallback(async () => {
    setState('starting');
    setError(null);
    let micStream: MediaStream | null = null;
    const stopMic = () => micStream?.getTracks().forEach((t) => t.stop());
    try {
      // 1) microfone PRIMEIRO (Story 2.2): feedback imediato ao médico e nenhum
      // pipeline órfão no servidor se a permissão for negada.
      const mic = await checkMicrophone(navigator.mediaDevices);
      if (mic.status !== 'ok' || !mic.stream) {
        setError(
          mic.status === 'denied'
            ? 'Permissão de microfone negada — libere no cadeado da barra de endereço e tente de novo.'
            : 'Nenhum microfone disponível.',
        );
        setState('error');
        return;
      }
      micStream = mic.stream;

      // 2) formato de gravação compatível com o STT (Safari/iOS não tem WebM/Opus
      // e o mp4/AAC transcreve silenciosamente NADA — melhor avisar antes).
      const mime = pickRecorderMime();
      if (!mime.supported) {
        stopMic();
        setError(
          'Este navegador não grava áudio em formato compatível com a transcrição — use Chrome ou Edge no computador.',
        );
        setState('error');
        return;
      }

      // 3) servidor arma o pipeline (Deepgram + sessão + board) — gate 1.4 incluso.
      // Resultado tipado: em produção o Next mascara mensagens de throw.
      const result = await startLiveBoardAction(consultationId);
      if (!result.ok) {
        stopMic();
        setError(ACTION_ERROR_MESSAGES[result.code]);
        setState('error');
        return;
      }

      // 4) captura → WS /audio (só áudio binário; eventos do board vão no /board)
      const source: AudioSource = createAudioSource(mic.stream, undefined, undefined, mime.mimeType);
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
        // não deixa mic/pipeline ligados com a UI em erro
        pumping = false;
        source.stop();
        void stopLiveBoardAction(consultationId).catch(() => {});
        setError('Falha no canal de áudio — verifique a rede e tente novamente.');
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
      stopMic();
      if (isStaleDeployError(err)) {
        setError('O sistema foi atualizado enquanto esta página estava aberta — recarregue a página e tente de novo.');
        setState('stale-deploy');
        return;
      }
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
          className="rounded-md border border-white/25 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {state === 'starting' ? '… preparando' : '🎙️ Consulta ao vivo'}
        </button>
      )}
      {error ? <p className="max-w-[220px] text-right text-[10px] text-red-300">{error}</p> : null}
      {warning && !error ? (
        <p className="max-w-[220px] text-right text-[10px] text-amber-300">{warning}</p>
      ) : null}
      {state === 'stale-deploy' ? (
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-md border border-white/25 px-2 py-1 text-[10px] font-semibold text-white hover:bg-white/10"
        >
          ↻ Recarregar página
        </button>
      ) : null}
    </div>
  );
}
