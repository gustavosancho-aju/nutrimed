'use client';

import { useBoardStore } from '@/lib/board-store';

/**
 * Faixa dos doutores (E7 — FR9 parcial/FR13). Vídeo em loop é E8 — aqui o
 * avatar estático + estado (ouvindo/sinalizando) + toggle de silenciar por
 * doutor (FR13). "Sinalizando" acende quando há ⚠️ recente da persona.
 */

const DOCTORS = [
  { id: 'aurelio', emoji: '🩺', name: 'Aurélio', ring: 'ring-doctor-aurelio' },
  { id: 'paulo', emoji: '❤️', name: 'Paulo', ring: 'ring-doctor-paulo' },
  { id: 'yara', emoji: '🔬', name: 'Yara', ring: 'ring-doctor-yara' },
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
            className={`flex flex-col items-center gap-1 rounded-[10px] border border-gray-200 bg-surface-muted p-2 ring-2 ${
              signaling ? 'ring-attn' : 'ring-transparent'
            } ${isSilenced ? 'opacity-50' : ''}`}
          >
            {/* placeholder do vídeo em loop (E8) — avatar estático com estado */}
            <span aria-hidden="true" className="text-2xl">{doctor.emoji}</span>
            <span className="text-xs font-semibold text-ink">{doctor.name}</span>
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
