'use client';

import { useEffect, useMemo } from 'react';
import type { SessionSnapshot } from '@nutrimed/session';
import { useBoardStream } from '@/lib/use-board-stream';
import { useUiTelemetry } from '@/lib/use-ui-telemetry';
import { useBoardStore } from '@/lib/board-store';
import { TranscriptPanel, type TranscriptSource } from './transcript-panel';
import { SuggestionFeed } from './suggestion-feed';
import { DoctorStrip } from './doctor-strip';
import { AlertVignette } from './alert-vignette';
import { LiveMicButton } from './live-mic-button';
import { PipelineStatusBadge } from './pipeline-status-badge';

/**
 * Tela de Consulta (E7 — frontend-spec §4): grid 2 colunas — área principal
 * fluida (transcrição ao vivo) + painel lateral fixo do BOARD (faixa dos
 * doutores, feed com hierarquia de segurança, Modo Foco com tecla F).
 * Em repouso: calmo, zero animação — o olho fica livre p/ o paciente.
 */
export function ConsultationRoom({
  consultationId,
  token,
  wsBaseUrl,
  advancedPanel,
}: {
  consultationId: string;
  token: string;
  wsBaseUrl: string;
  /** "Consulta simulada" + "Síntese" — pouco usadas no dia a dia (feedback do
   * piloto), agrupadas atrás de um `<details>` em vez de botões sempre à vista. */
  advancedPanel: React.ReactNode;
}) {
  useBoardStream(consultationId, { baseUrl: wsBaseUrl, token });
  useUiTelemetry(consultationId); // E10 — ruído/aceite (R3/§9)
  const transcript = useBoardStore((s) => s.transcript);
  const focusMode = useBoardStore((s) => s.focusMode);
  const toggleFocusMode = useBoardStore((s) => s.toggleFocusMode);

  // Modo Foco com tecla F (FR16) — 1 tecla, sem modificador
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      toggleFocusMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFocusMode]);

  // adapta o transcript do store ao contrato do <TranscriptPanel> (2.4 — REUSE)
  const transcriptSource = useMemo<TranscriptSource>(() => {
    let cached: SessionSnapshot | null = null;
    let cachedFor: typeof transcript | null = null;
    return {
      getSnapshot: () => {
        if (cachedFor !== transcript || !cached) {
          cached = {
            consultationId,
            status: 'live',
            finalSegments: transcript.finals.map((text) => ({ text, isFinal: true })),
            partial: transcript.partial ? { text: transcript.partial, isFinal: false } : null,
            error: null,
          };
          cachedFor = transcript;
        }
        return cached;
      },
      subscribe: () => () => {}, // re-render via zustand — assinatura é no-op
    };
  }, [transcript, consultationId]);

  return (
    <section
      aria-label="Sala do board"
      className="surface-deep-gradient gold-hairline rounded-2xl border border-white/10 p-4 shadow-[0_2px_4px_hsl(var(--text)/0.08),0_20px_50px_hsl(var(--text)/0.22)] lg:p-5"
    >
      {/* ⚠️ crítico: a sala inteira responde (vinheta periférica 2s) */}
      <AlertVignette />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Sala do Board
          <span className="ml-2 text-xs font-normal tracking-wide text-emerald-200/70">
            ● 3 especialistas presentes
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <PipelineStatusBadge />
          <span
            title="⚠️ atenção · 💡 sugestão · 🔍 hipótese · 📋 síntese"
            className="cursor-help text-xs text-white/50"
          >
            ⓘ 4 tipos
          </span>
        </div>
      </div>

      {/* faixa hero — os médicos acompanham a consulta, grandes e presentes */}
      <DoctorStrip />

      {/* a "mesa" da reunião: transcrição (documento iluminado) + feed */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="flex min-h-[420px] flex-col">
          <TranscriptPanel source={transcriptSource} />
        </div>

        <aside aria-label="Painel do board" className="flex min-h-[420px] flex-col gap-3">
          <SuggestionFeed />
        </aside>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          aria-pressed={focusMode}
          onClick={toggleFocusMode}
          className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
            focusMode
              ? 'bg-white text-surface-deep'
              : 'border border-white/25 text-white hover:bg-white/10'
          }`}
        >
          🔇 Modo Foco <kbd className="ml-1 rounded bg-black/20 px-1">F</kbd>
        </button>
        <div className="relative flex items-start gap-2">
          {advancedPanel}
          <LiveMicButton consultationId={consultationId} token={token} wsBaseUrl={wsBaseUrl} />
        </div>
      </div>
    </section>
  );
}
