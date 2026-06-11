'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionSnapshot } from '@nutrimed/session';

/**
 * <TranscriptPanel> — Feature (frontend-spec §11) — Story 2.4 / FR1.
 *
 * Display da transcrição ao vivo com auto-follow. Consome a sessão da Story 2.3
 * via snapshot+subscribe (nunca fala com o STT direto). Estados: streaming /
 * pausado / erro-transcrição (o erro integra com o banner da Story 2.6).
 *
 * A11y (padrão Story 1.7): `role="log"`; apenas segmentos FINAIS são anunciados
 * (`aria-live="polite"` num sub-elemento) para não metralhar o leitor de tela
 * com parciais; zero animação (`prefers-reduced-motion` por construção).
 */

/** Contrato mínimo que o painel consome da sessão (2.3) — facilita teste/mokagem. */
export interface TranscriptSource {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
}

export type PanelState = 'streaming' | 'pausado' | 'erro-transcricao';

function panelState(snapshot: SessionSnapshot): PanelState {
  if (snapshot.status === 'degraded') return 'erro-transcricao';
  if (snapshot.status === 'ended') return 'pausado';
  return 'streaming';
}

const STATE_LABEL: Record<PanelState, string> = {
  streaming: '● Transcrevendo ao vivo',
  pausado: '⏸ Transcrição pausada',
  'erro-transcricao': '⚠️ Transcrição instável',
};

/** Distância (px) do fundo abaixo da qual consideramos "na ponta" do log. */
const FOLLOW_THRESHOLD_PX = 24;

export function TranscriptPanel({ source }: { source: TranscriptSource }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => source.getSnapshot());
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = source.subscribe(() => setSnapshot(source.getSnapshot()));
    setSnapshot(source.getSnapshot());
    return unsubscribe;
  }, [source]);

  // auto-follow: novos segmentos mantêm a visão na ponta enquanto `following`
  useEffect(() => {
    if (following && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [snapshot, following]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
    setFollowing(atBottom);
  }, []);

  const resumeFollow = useCallback(() => {
    setFollowing(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const state = panelState(snapshot);

  return (
    <section aria-label="Transcrição da consulta" className="flex h-full flex-col rounded-lg border border-gray-200">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-700">Transcrição</h2>
        <span
          data-testid="panel-state"
          data-state={state}
          className={
            state === 'erro-transcricao'
              ? 'text-xs font-medium text-amber-700'
              : state === 'pausado'
                ? 'text-xs text-gray-500'
                : 'text-xs text-green-700'
          }
        >
          {STATE_LABEL[state]}
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        className="flex-1 space-y-2 overflow-y-auto p-4"
      >
        {/* finais: imutáveis, anunciados ao leitor de tela */}
        <div aria-live="polite">
          {snapshot.finalSegments.map((segment, i) => (
            <p key={i} className="text-sm text-gray-900">
              {segment.text}
            </p>
          ))}
        </div>
        {/* parcial corrente: provisório, visualmente distinto, NÃO anunciado */}
        {snapshot.partial ? (
          <p data-testid="partial-segment" aria-hidden="true" className="text-sm italic text-gray-400">
            {snapshot.partial.text}
          </p>
        ) : null}
      </div>

      {!following ? (
        <button
          type="button"
          onClick={resumeFollow}
          className="border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          ↓ Voltar ao vivo
        </button>
      ) : null}
    </section>
  );
}
