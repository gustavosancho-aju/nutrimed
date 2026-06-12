'use client';

import Image from 'next/image';
import { useBoardStore } from '@/lib/board-store';

/**
 * Faixa dos doutores (E7 — FR9 parcial/FR13), estilo VIDEOCHAMADA: tiles
 * grandes com o retrato preenchendo o quadro (sensação de presença — eles
 * estão acompanhando a consulta). Vídeo em loop é E8 — o slot já tem a
 * proporção certa. Estados: ouvindo (calmo) / falando (glow jade, qualquer
 * contribuição recente) / sinalizando (ring de atenção, ⚠️ crítico recente) /
 * silenciado (FR13). Fallback p/ falha de imagem = emoji (degradação graciosa).
 */

const DOCTORS = [
  { id: 'aurelio', emoji: '🩺', name: 'Dr. Aurélio', specialty: 'Nutrologia' },
  { id: 'paulo', emoji: '❤️', name: 'Dr. Paulo', specialty: 'Cardiologia' },
  { id: 'yara', emoji: '🔬', name: 'Dra. Yara', specialty: 'Endocrinologia' },
] as const;

const SIGNAL_WINDOW_MS = 8000;
const SPEAK_WINDOW_MS = 6000;

export function DoctorStrip() {
  const contributions = useBoardStore((s) => s.contributions);
  const silenced = useBoardStore((s) => s.silenced);
  const toggleSilence = useBoardStore((s) => s.toggleSilence);
  const now = Date.now();

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {DOCTORS.map((doctor) => {
        const isSilenced = silenced.has(doctor.id);
        const signaling = contributions.some(
          (c) =>
            c.contribution.personaId === doctor.id &&
            c.contribution.severity === 'critical' &&
            now - c.at < SIGNAL_WINDOW_MS,
        );
        const speaking =
          !signaling &&
          contributions.some(
            (c) => c.contribution.personaId === doctor.id && now - c.at < SPEAK_WINDOW_MS,
          );
        return (
          <figure
            key={doctor.id}
            data-testid={`doctor-${doctor.id}`}
            data-state={
              isSilenced ? 'silenciado' : signaling ? 'sinalizando' : speaking ? 'falando' : 'ouvindo'
            }
            className={`group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/10 bg-white/5 ring-2 transition-shadow ${
              signaling
                ? 'ring-attn shadow-[0_0_24px_hsl(var(--attn)/0.45)]'
                : speaking
                  ? 'ring-emerald-300/70 shadow-[0_0_20px_hsl(168_60%_55%/0.35)]'
                  : 'ring-transparent'
            } ${isSilenced ? 'opacity-50' : ''}`}
          >
            {/* retrato preenchendo o quadro — o slot vira vídeo em loop no E8 */}
            <Image
              src={`/personas/${doctor.id}.png`}
              alt={`${doctor.name} — ${doctor.specialty}`}
              width={280}
              height={350}
              priority
              className={`h-full w-full object-cover ${isSilenced ? 'grayscale' : ''}`}
            />

            {/* véu inferior com identificação — padrão videochamada */}
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pb-1.5 pt-6">
              <p className="font-display text-[13px] font-semibold leading-tight text-white">
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
            </figcaption>

            {/* silenciar (FR13) — canto superior, discreto até o hover */}
            <button
              type="button"
              aria-pressed={isSilenced}
              onClick={() => toggleSilence(doctor.id)}
              className="absolute right-1.5 top-1.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 opacity-0 backdrop-blur-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              {isSilenced ? 'reativar' : 'silenciar'}
            </button>
          </figure>
        );
      })}
    </div>
  );
}
