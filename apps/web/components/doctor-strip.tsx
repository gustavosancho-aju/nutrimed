'use client';

import Image from 'next/image';
import { useEffect, useReducer } from 'react';
import { useBoardStore, type BoardContributionItem } from '@/lib/board-store';

/**
 * Faixa HERO dos doutores (Sala de Board — E7/FR9/FR13): três quadros grandes
 * de videochamada cruzando o topo da sala. Quem contribui ganha SPOTLIGHT (o
 * quadro cresce, como active-speaker do Meet), balão de fala com a contribuição
 * e equalizador pulsando. Em repouso a sala é 100% parada (frontend-spec §6.4).
 * Vídeo em loop é E8 — os quadros já têm a proporção do slot.
 *
 * A11y: balão é aria-hidden (o feed anuncia via ARIA-live — sem duplicar);
 * reduced-motion desliga equalizador e a transição de tamanho (CSS).
 */

const DOCTORS = [
  { id: 'aurelio', emoji: '🩺', name: 'Dr. Aurélio', specialty: 'Nutrologia' },
  { id: 'paulo', emoji: '❤️', name: 'Dr. Paulo', specialty: 'Cardiologia' },
  { id: 'yara', emoji: '🔬', name: 'Dra. Yara', specialty: 'Endocrinologia' },
] as const;

const SIGNAL_WINDOW_MS = 8000;
const SPEAK_WINDOW_MS = 7000;
const SNIPPET_MAX = 150;

const TYPE_ICON: Record<string, string> = {
  atencao: '⚠️',
  sugestao: '💡',
  hipotese: '🔍',
  sintese: '📋',
};

function latestBy(
  contributions: BoardContributionItem[],
  personaId: string,
): BoardContributionItem | null {
  for (let i = contributions.length - 1; i >= 0; i--) {
    if (contributions[i]!.contribution.personaId === personaId) return contributions[i]!;
  }
  return null;
}

export function DoctorStrip() {
  const contributions = useBoardStore((s) => s.contributions);
  const silenced = useBoardStore((s) => s.silenced);
  const toggleSilence = useBoardStore((s) => s.toggleSilence);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const now = Date.now();

  const states = DOCTORS.map((doctor) => {
    const latest = latestBy(contributions, doctor.id);
    const isSilenced = silenced.has(doctor.id);
    const signaling =
      !!latest &&
      contributions.some(
        (c) =>
          c.contribution.personaId === doctor.id &&
          c.contribution.severity === 'critical' &&
          now - c.at < SIGNAL_WINDOW_MS,
      );
    const speaking = !signaling && !!latest && now - latest.at < SPEAK_WINDOW_MS;
    return { doctor, latest, isSilenced, signaling, speaking };
  });

  // spotlight = persona ativa mais recente (sinalizando vence empate)
  const activeIdx = states.reduce<number>((best, s, i) => {
    if (!s.signaling && !s.speaking) return best;
    if (best === -1) return i;
    const a = states[best]!;
    return (s.latest?.at ?? 0) > (a.latest?.at ?? 0) ? i : best;
  }, -1);

  // enquanto há fala/sinal ativo, re-renderiza a cada 1s p/ expirar as janelas
  const anyActive = activeIdx !== -1;
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [anyActive]);

  return (
    <div
      data-testid="doctor-hero"
      className="grid gap-3 transition-[grid-template-columns] duration-500 ease-out motion-reduce:transition-none"
      style={{
        gridTemplateColumns: DOCTORS.map((_, i) => (i === activeIdx ? '1.55fr' : '1fr')).join(' '),
      }}
    >
      {states.map(({ doctor, latest, isSilenced, signaling, speaking }, i) => {
        const inSpotlight = i === activeIdx;
        const bubble =
          inSpotlight && latest && !isSilenced
            ? latest.contribution.text.length > SNIPPET_MAX
              ? `${latest.contribution.text.slice(0, SNIPPET_MAX)}…`
              : latest.contribution.text
            : null;
        return (
          <figure
            key={doctor.id}
            data-testid={`doctor-${doctor.id}`}
            data-state={
              isSilenced ? 'silenciado' : signaling ? 'sinalizando' : speaking ? 'falando' : 'ouvindo'
            }
            className={`group relative h-56 overflow-hidden rounded-2xl border border-white/10 bg-white/5 ring-2 transition-shadow xl:h-64 ${
              signaling
                ? 'ring-attn shadow-[0_0_32px_hsl(var(--attn)/0.5)]'
                : speaking
                  ? 'ring-emerald-300/70 shadow-[0_0_26px_hsl(168_60%_55%/0.4)]'
                  : 'ring-transparent'
            } ${isSilenced ? 'opacity-50' : ''}`}
          >
            {/* retrato preenchendo o quadro — o slot vira vídeo em loop no E8 */}
            <Image
              src={`/personas/${doctor.id}.png`}
              alt={`${doctor.name} — ${doctor.specialty}`}
              width={560}
              height={460}
              priority
              className={`h-full w-full object-cover object-top ${isSilenced ? 'grayscale' : ''}`}
            />

            {/* balão de fala — a contribuição "sai" do quadro de quem falou */}
            {bubble ? (
              <div
                aria-hidden="true"
                data-testid={`speech-${doctor.id}`}
                className={`board-entry absolute inset-x-2.5 bottom-[58px] rounded-xl border p-2.5 backdrop-blur-md ${
                  signaling
                    ? 'border-attn/60 bg-black/75 ring-1 ring-attn/40'
                    : 'border-white/15 bg-black/65'
                }`}
              >
                <p className="text-[12px] leading-snug text-white/95">
                  <span className="mr-1">{TYPE_ICON[latest!.contribution.type] ?? '💡'}</span>
                  {bubble}
                </p>
              </div>
            ) : null}

            {/* véu inferior com identificação — padrão videochamada */}
            <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-8">
              <div>
                <p className="font-display text-sm font-semibold leading-tight text-white">
                  {doctor.name}
                </p>
                <p className="text-[10px] leading-tight text-white/70">{doctor.specialty}</p>
                <p className="mt-0.5 text-[10px] font-medium">
                  {isSilenced ? (
                    <span className="text-white/60">🔇 silenciado</span>
                  ) : signaling ? (
                    <span className="text-attn">▲ sinalizando</span>
                  ) : speaking ? (
                    <span className="text-emerald-300">● falando</span>
                  ) : (
                    <span className="text-emerald-200/80">● ouvindo</span>
                  )}
                </p>
              </div>

              {/* equalizador — só enquanto há fala/sinal ativo */}
              {(speaking || signaling) && !isSilenced ? (
                <div aria-hidden="true" className="mb-1 flex items-end gap-[3px]">
                  <span className={`eq-bar h-3 w-[3px] rounded-full ${signaling ? 'bg-attn' : 'bg-emerald-300'}`} />
                  <span className={`eq-bar h-4 w-[3px] rounded-full [animation-delay:150ms] ${signaling ? 'bg-attn' : 'bg-emerald-300'}`} />
                  <span className={`eq-bar h-2.5 w-[3px] rounded-full [animation-delay:300ms] ${signaling ? 'bg-attn' : 'bg-emerald-300'}`} />
                </div>
              ) : null}
            </figcaption>

            {/* silenciar (FR13) — canto superior, discreto até o hover */}
            <button
              type="button"
              aria-pressed={isSilenced}
              onClick={() => toggleSilence(doctor.id)}
              className="absolute right-2 top-2 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/90 opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              {isSilenced ? 'reativar' : 'silenciar'}
            </button>
          </figure>
        );
      })}
    </div>
  );
}
