'use client';

import { useState } from 'react';
import { classifyImc, computeGoalGap, imcFromWeight } from '@/lib/dashboard';
import { IMC_TONE_BG } from '@/lib/imc-colors';
import type { BodySex } from '@/lib/body-profile';
import { BodyFigureStage } from './body-figure-stage';
import { IconRotate } from '@/components/icons';

/** Opções de corpo do manequim — Neutro primeiro: ninguém é forçado a escolher. */
const SEX_OPTIONS: { value: BodySex; label: string }[] = [
  { value: 'neutro', label: 'Neutro' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'masculino', label: 'Masculino' },
];

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
  // Corpo do manequim: escolha do MÉDICO no palco (o cadastro não guarda sexo;
  // persistir seria migration — decisão futura). Neutro preserva o histórico.
  const [sexo, setSexo] = useState<BodySex>('neutro');

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
      {/* Palco: manequim 3D quando há WebGL; silhueta SVG como linha de base */}
      <BodyFigureStage
        imc={imc}
        sex={sexo}
        ghostImc={metaImc ?? undefined}
        className="h-[340px] w-[250px]"
      />

      {/* corpo do manequim — segmentado discreto, sob o palco */}
      <div
        role="radiogroup"
        aria-label="Corpo do manequim"
        className="mt-2 flex overflow-hidden rounded-full border border-ink/15 text-[11px]"
      >
        {SEX_OPTIONS.map((opt) => {
          const active = sexo === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSexo(opt.value)}
              className={`px-3 py-1 transition-colors ${
                active
                  ? 'bg-brand font-semibold text-on-brand'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 flex items-center gap-2 rounded-full border border-ink/10 bg-surface-muted px-4 py-1.5 text-sm font-semibold text-ink">
        <span aria-hidden className={`h-2 w-2 rounded-full ${IMC_TONE_BG[categoria.tone]}`} />
        {categoria.label}
      </p>

      {metaImc !== null && metaPeso !== null && (
        // A meta deixou de ser um aro no corpo: aqui ela é um BOTÃO que leva o
        // corpo inteiro até o peso-alvo — a comparação mais forte que existe
        // na frente do paciente é ver a própria anatomia mudar.
        <button
          type="button"
          disabled={!interactive}
          onClick={() => setPesoSim(metaPeso)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-600/10 px-3 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-600/20 disabled:opacity-50 dark:text-emerald-400"
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-600" />
          Ver o corpo na meta ({fmt(metaPeso)} kg
          {metaDefinidaPeloMedico ? ', do médico' : ', OMS'})
        </button>
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
              className="slider-premium mt-1.5 w-full"
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
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-[8px] border border-ink/15 px-3 py-1 text-[11px] text-ink transition-colors hover:bg-surface-muted"
              >
                <IconRotate className="h-3 w-3" /> Voltar ao peso atual
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
