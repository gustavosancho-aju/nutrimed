import { computeGoalGap, computeTrend, type TrendPoint, type TargetBand } from '@/lib/dashboard';
import { TrendChart } from './trend-chart';

/** Formata número: inteiro sem casas, senão 1 casa decimal. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Card de métrica (E11/11.6 + evolução visual): valor atual + variação vs.
 * anterior + gráfico com o PONTO ATUAL desde a 1ª medição, faixa ideal (banda)
 * e meta (linha pontilhada) quando aplicável. A variação usa seta direcional
 * SEM juízo clínico de cor — a interpretação é do médico.
 */
export function MetricCard({
  label,
  points,
  unit,
  band,
  target,
  targetLabel,
}: {
  label: string;
  points: readonly TrendPoint[];
  unit?: string;
  /** Faixa ideal (banda verde no gráfico). */
  band?: TargetBand;
  /** Meta/alvo (linha pontilhada no gráfico). */
  target?: number;
  /** Rótulo textual da faixa/meta (ex.: "Faixa ideal 57–77 kg · meta ~68 kg"). */
  targetLabel?: string;
}) {
  const trend = computeTrend(points);

  return (
    <div className="card-premium p-5">
      <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      {trend === null ? (
        <p className="mt-2 text-sm text-ink-muted">Sem medições.</p>
      ) : (
        <>
          <p className="mt-1 font-display text-3xl font-bold text-ink">
            {fmt(trend.current)}
            {unit && <span className="ml-1 text-base font-normal text-ink-muted">{unit}</span>}
          </p>
          {trend.delta !== null && (
            <p className="mt-0.5 text-sm text-ink-muted">
              <span aria-hidden>{trend.delta > 0 ? '▲' : trend.delta < 0 ? '▼' : '–'}</span>{' '}
              {fmt(Math.abs(trend.delta))}
              {unit} vs. anterior
              {trend.deltaPct !== null && ` (${trend.deltaPct > 0 ? '+' : ''}${trend.deltaPct.toFixed(1)}%)`}
            </p>
          )}
          {targetLabel && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span aria-hidden className="inline-block h-1.5 w-3 rounded-full bg-emerald-500/70" />
              {targetLabel}
            </p>
          )}
          {target !== undefined &&
            (() => {
              // "% pra meta": distância do valor atual à meta — sem juízo de cor
              // (a direção desejada varia por métrica; o médico interpreta).
              const gap = computeGoalGap(trend.current, target);
              return gap ? (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                  <span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed border-emerald-600/80" />
                  Meta {fmt(target)}
                  {unit ?? ''} · {gap.label}
                </p>
              ) : null;
            })()}
          {points.length >= 1 && (
            <div className="mt-3">
              <TrendChart points={points} unit={unit} band={band} target={target} />
            </div>
          )}
          {points.length === 1 && (
            <p className="mt-2 text-[11px] text-ink-muted">
              Ponto atual marcado. A linha de evolução se forma a partir da 2ª medição.
            </p>
          )}
        </>
      )}
    </div>
  );
}
