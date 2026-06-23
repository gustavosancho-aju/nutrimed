import { computeTrend, type TrendPoint } from '@/lib/dashboard';
import { TrendChart } from './trend-chart';

/** Formata número: inteiro sem casas, senão 1 casa decimal. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Card de métrica (E11/11.6): valor atual + variação vs. anterior + mini-tendência.
 * A variação é exibida com seta direcional e SEM juízo clínico de cor (a
 * interpretação é do médico) — apenas indica sentido e magnitude.
 */
export function MetricCard({
  label,
  points,
  unit,
}: {
  label: string;
  points: readonly TrendPoint[];
  unit?: string;
}) {
  const trend = computeTrend(points);

  return (
    <div className="card-premium p-5">
      <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      {trend === null ? (
        <p className="mt-2 text-sm text-ink-muted">Sem medições.</p>
      ) : (
        <>
          <p className="mt-1 font-display text-2xl font-semibold text-ink">
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
          {points.length > 1 && (
            <div className="mt-3">
              <TrendChart points={points} unit={unit} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
