'use client';

import { useState } from 'react';
import { classifyImc, computeGoalGap, imcFromWeight } from '@/lib/dashboard';
import { BodyFigure } from './body-figure';

/**
 * Simulador corporal interativo (modo apresentação): o médico arrasta o peso
 * e a silhueta morfa em tempo real (IMC recalculado pela altura derivada),
 * sobreposta ao CONTORNO tracejado da meta. Ferramenta de CONVERSA com o
 * paciente — simulação ilustrativa por IMC, não previsão clínica (a composição
 * real de massa/gordura não é proporcional ao peso).
 *
 * Sem altura derivável ou sem peso atual, degrada para a figura estática.
 */

function fmt(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function BodySimulator({
  imcAtual,
  pesoAtual,
  heightM,
  metaPeso,
  metaDefinidaPeloMedico,
}: {
  imcAtual: number;
  pesoAtual: number | null;
  heightM: number | null;
  /** Meta de peso (kg) — do médico (body_goal) ou derivada da OMS. */
  metaPeso: number | null;
  metaDefinidaPeloMedico: boolean;
}) {
  const [pesoSim, setPesoSim] = useState<number | null>(null);

  const interactive = pesoAtual !== null && heightM !== null;
  const peso = pesoSim ?? pesoAtual;
  const imc = interactive && peso !== null ? (imcFromWeight(peso, heightM) ?? imcAtual) : imcAtual;
  const metaImc = heightM !== null && metaPeso !== null ? imcFromWeight(metaPeso, heightM) : null;
  const categoria = classifyImc(imc);
  const simulando = pesoSim !== null && pesoAtual !== null && pesoSim !== pesoAtual;
  const gap = peso !== null && metaPeso !== null ? computeGoalGap(peso, metaPeso) : null;

  const min = pesoAtual !== null ? Math.max(35, Math.floor(Math.min(pesoAtual, metaPeso ?? pesoAtual) - 30)) : 40;
  const max = pesoAtual !== null ? Math.ceil(Math.max(pesoAtual, metaPeso ?? pesoAtual) + 30) : 150;

  return (
    <div className="flex flex-col items-center">
      <BodyFigure imc={imc} ghostImc={metaImc ?? undefined} className="h-[340px] w-auto" />

      <p className="mt-3 rounded-full border border-ink/10 bg-surface-muted px-4 py-1.5 text-sm font-semibold text-ink">
        {categoria.label}
      </p>

      {metaImc !== null && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span aria-hidden className="inline-block h-0 w-4 border-t-2 border-dashed border-emerald-600/80" />
          Contorno = silhueta na meta ({fmt(metaPeso!)} kg
          {metaDefinidaPeloMedico ? ', definida pelo médico' : ', referência OMS'})
        </p>
      )}

      {interactive && (
        <div className="mt-4 w-full max-w-[260px]">
          <label className="block">
            <span className="flex items-baseline justify-between text-xs text-ink-muted">
              <span>Simular peso</span>
              <span className="font-display text-base font-semibold text-ink">
                {fmt(peso!)} kg
                <span className="ml-1.5 text-xs font-normal text-ink-muted">IMC {fmt(imc)}</span>
              </span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={0.5}
              value={peso!}
              onChange={(e) => setPesoSim(Number(e.target.value))}
              className="mt-1.5 w-full accent-emerald-600"
              aria-label={`Simular peso em quilogramas (atual ${fmt(pesoAtual)} kg)`}
            />
          </label>

          {simulando ? (
            <div className="mt-1 text-center text-[11px] text-ink-muted">
              <p>
                <span aria-hidden>{pesoSim! > pesoAtual ? '▲' : '▼'}</span>{' '}
                {fmt(Math.abs(pesoSim! - pesoAtual))} kg vs. atual
                {gap && ` · ${gap.label}`}
              </p>
              <button
                type="button"
                onClick={() => setPesoSim(null)}
                className="mt-1.5 rounded-[8px] border border-ink/15 px-3 py-1 text-[11px] text-ink transition-colors hover:bg-surface-muted"
              >
                ↺ Voltar ao peso atual
              </button>
            </div>
          ) : (
            <p className="mt-1 text-center text-[11px] text-ink-muted">
              Arraste para simular — a silhueta acompanha.
            </p>
          )}

          <p className="mt-2 text-center text-[10px] leading-snug text-ink-muted/80">
            Simulação ilustrativa por IMC — não é previsão clínica.
          </p>
        </div>
      )}
    </div>
  );
}
