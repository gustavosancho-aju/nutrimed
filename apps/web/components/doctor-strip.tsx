'use client';

import Image from 'next/image';
import { useBoardStore } from '@/lib/board-store';

/**
 * Faixa dos doutores (E7 — FR9 parcial/FR13). Vídeo em loop é E8 — aqui o
 * RETRATO da persona (identidade visual gerada, cada um à mesa do consultório)
 * + estado (ouvindo/sinalizando) + toggle de silenciar (FR13). "Sinalizando"
 * acende quando há ⚠️ recente da persona. Fallback p/ falha de imagem = emoji
 * (frontend-spec §3.1 — degradação graciosa).
 */

const DOCTORS = [
  { id: 'aurelio', emoji: '🩺', name: 'Dr. Aurélio', specialty: 'Nutrologia' },
  { id: 'paulo', emoji: '❤️', name: 'Dr. Paulo', specialty: 'Cardiologia' },
  { id: 'yara', emoji: '🔬', name: 'Dra. Yara', specialty: 'Endocrinologia' },
] as const;

const SIGNAL_WINDOW_MS = 8000;

export function DoctorStrip() {
  const contributions = useBoardStore((s) => s.contributions);
  const silenced = useBoardStore((s) => s.silenced);
  const toggleSilence = useBoardStore((s) => s.toggleSilence);
  const now = Date.now();

  return (
    <div className="grid grid-cols-3 gap-2">
      {DOCTORS.map((doctor) => {
        const isSilenced = silenced.has(doctor.id);
        const signaling = contributions.some(
          (c) =>
            c.contribution.personaId === doctor.id &&
            c.contribution.severity === 'critical' &&
            now - c.at < SIGNAL_WINDOW_MS,
        );
        return (
          <div
            key={doctor.id}
            data-testid={`doctor-${doctor.id}`}
            data-state={isSilenced ? 'silenciado' : signaling ? 'sinalizando' : 'ouvindo'}
            className={`flex flex-col items-center gap-1 rounded-[10px] border border-ink/10 bg-surface-muted p-2 ring-2 ${
              signaling ? 'ring-attn' : 'ring-transparent'
            } ${isSilenced ? 'opacity-50' : ''}`}
          >
            {/* retrato da persona — o slot vira vídeo em loop no E8 */}
            <Image
              src={`/personas/${doctor.id}.png`}
              alt={`${doctor.name} — ${doctor.specialty}`}
              width={104}
              height={104}
              priority
              className={`aspect-square w-full max-w-[104px] rounded-[10px] object-cover ring-1 ${
                signaling ? 'ring-attn' : 'ring-accent-gold/60'
              } ${isSilenced ? 'grayscale' : ''}`}
            />
            <span className="font-display text-xs font-semibold text-ink">{doctor.name}</span>
            <span className="text-[10px] text-ink-muted">
              {isSilenced ? '🔇 silenciado' : signaling ? '▲ sinalizando' : '● ouvindo'}
            </span>
            <button
              type="button"
              aria-pressed={isSilenced}
              onClick={() => toggleSilence(doctor.id)}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted hover:bg-white"
            >
              {isSilenced ? 'reativar' : 'silenciar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
