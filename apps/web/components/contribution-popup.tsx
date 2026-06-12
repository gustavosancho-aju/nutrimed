'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useBoardStore, type BoardContributionItem } from '@/lib/board-store';

/**
 * Pop-up de interação (E7+ — presença do board): quando uma persona contribui,
 * um card transitório com o RETRATO dela surge sobre a área da consulta — a
 * sensação de que o especialista "se inclinou para falar". Some sozinho (6,5s;
 * ⚠️ crítico fica 9s e ganha borda de atenção).
 *
 * A11y: `aria-hidden` — o anúncio ao leitor de tela já é feito pelas regiões
 * ARIA-live do <SuggestionFeed/> (evita anúncio duplicado). Entrada reusa
 * `.board-entry` (respeita prefers-reduced-motion). O card do feed permanece —
 * o pop-up é só o aceno.
 */

const PERSONA: Record<string, { name: string; specialty: string }> = {
  aurelio: { name: 'Dr. Aurélio', specialty: 'Nutrologia' },
  paulo: { name: 'Dr. Paulo', specialty: 'Cardiologia' },
  yara: { name: 'Dra. Yara', specialty: 'Endocrinologia' },
};

const TYPE_LABEL: Record<string, { icon: string; label: string; color: string }> = {
  atencao: { icon: '⚠️', label: 'PONTO DE ATENÇÃO', color: 'text-attn' },
  sugestao: { icon: '💡', label: 'SUGESTÃO', color: 'text-sky-300' },
  hipotese: { icon: '🔍', label: 'HIPÓTESE', color: 'text-violet-300' },
  sintese: { icon: '📋', label: 'SÍNTESE DO BOARD', color: 'text-white/70' },
};

const POPUP_MS = 6500;
const POPUP_CRITICAL_MS = 9000;
const SNIPPET_MAX = 160;

export function ContributionPopup() {
  const contributions = useBoardStore((s) => s.contributions);
  const [item, setItem] = useState<BoardContributionItem | null>(null);
  const seenRef = useRef<string | null>(null);
  const mountedAtRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const latest = contributions[contributions.length - 1];
    if (!latest || latest.id === seenRef.current) return;
    seenRef.current = latest.id;
    // ignora histórico pré-existente no mount (reload no meio da consulta)
    if (latest.at < mountedAtRef.current) return;

    setItem(latest);
    if (timerRef.current) clearTimeout(timerRef.current);
    const ttl = latest.contribution.severity === 'critical' ? POPUP_CRITICAL_MS : POPUP_MS;
    timerRef.current = setTimeout(() => setItem(null), ttl);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [contributions]);

  if (!item) return null;

  const persona = PERSONA[item.contribution.personaId] ?? PERSONA.aurelio!;
  const type = TYPE_LABEL[item.contribution.type] ?? TYPE_LABEL.sugestao!;
  const critical = item.contribution.severity === 'critical';
  const text =
    item.contribution.text.length > SNIPPET_MAX
      ? `${item.contribution.text.slice(0, SNIPPET_MAX)}…`
      : item.contribution.text;

  return (
    <div
      aria-hidden="true"
      data-testid="contribution-popup"
      className="pointer-events-none fixed bottom-16 left-6 z-40 max-w-sm"
    >
      <div
        className={`board-entry surface-deep-gradient flex gap-3 rounded-2xl border p-4 shadow-[0_8px_18px_hsl(var(--text)/0.25),0_24px_60px_hsl(var(--text)/0.3)] backdrop-blur-md ${
          critical ? 'border-attn/60 ring-2 ring-attn/40' : 'border-white/15'
        }`}
      >
        <Image
          src={`/personas/${item.contribution.personaId}.png`}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-accent-gold/60"
        />
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold leading-tight text-white">
            {persona.name}
            <span className="ml-1 text-xs font-normal text-white/55">· {persona.specialty}</span>
          </p>
          <p className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide ${type.color}`}>
            {type.icon} {type.label}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-white/90">{text}</p>
        </div>
      </div>
    </div>
  );
}
