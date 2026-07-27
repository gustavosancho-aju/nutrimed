import { REFERENCE_STATUS_LABEL, type ReferenceStatus } from '@nutrimed/lab-catalog';
import { rangeLabel, type AnalyteSeries } from '@/lib/lab-panel';
import type { TargetBand } from '@/lib/dashboard';
import { TrendChart } from './trend-chart';

/**
 * Card de um exame do painel (E14) — valor atual, situação perante a faixa do
 * LAUDO e a linha de evolução, com o mesmo componente de gráfico da
 * bioimpedância.
 *
 * A faixa vira apoio visual do jeito que couber: intervalo fechado ("3,5 a 8,5")
 * vira a BANDA verde; limite aberto ("inferior a 130") vira a LINHA pontilhada,
 * porque uma banda precisaria de um piso que o laudo não informou — e inventar
 * esse piso seria inventar referência clínica.
 *
 * A cor SEMPRE vem acompanhada de rótulo textual (acessibilidade/NFR10), e o
 * juízo é binário — dentro/fora do que o laboratório imprimiu. Graduar risco é
 * do médico.
 */

const STATUS_BADGE: Record<ReferenceStatus, string> = {
  dentro: 'border-emerald-300/50 bg-emerald-400/10 text-emerald-700',
  fora: 'border-amber-300/60 bg-amber-400/10 text-amber-700',
  'sem-referencia': 'border-ink/15 bg-surface-muted text-ink-muted',
};

const CHART_TONE: Record<ReferenceStatus, string> = {
  dentro: 'text-emerald-600',
  fora: 'text-amber-600',
  'sem-referencia': 'text-brand',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

/** Banda só com intervalo fechado; limite aberto vira linha de referência. */
export function bandAndTarget(s: AnalyteSeries): { band?: TargetBand; target?: number } {
  const r = s.range;
  if (!r) return {};
  if (r.min !== undefined && r.max !== undefined) return { band: { min: r.min, max: r.max } };
  const limite = r.max ?? r.min;
  return limite !== undefined ? { target: limite } : {};
}

export function AnalyteCard({
  series,
  showChart = true,
}: {
  series: AnalyteSeries;
  /** Gráfico só faz sentido com 2+ pontos; a lista compacta pode desligá-lo. */
  showChart?: boolean;
}) {
  const faixa = rangeLabel(series);
  const { band, target } = bandAndTarget(series);

  return (
    <div className="card-premium p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-ink-muted">{series.label}</p>
        {series.unit && <span className="text-[11px] text-ink-muted">{series.unit}</span>}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <span className="font-display text-3xl font-bold text-ink">{fmt(series.latest)}</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[series.status]}`}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {REFERENCE_STATUS_LABEL[series.status]}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-ink-muted">
        {faixa ? `Referência do laudo: ${faixa}` : 'Sem faixa de referência — interpretação do médico.'}
        {' · '}
        {DATE_FMT.format(series.latestAt)}
      </p>

      {showChart && series.points.length > 1 && (
        <div className="mt-3">
          <TrendChart
            points={series.points}
            className={CHART_TONE[series.status]}
            unit={series.unit}
            band={band}
            target={target}
          />
        </div>
      )}
      {showChart && series.points.length === 1 && (
        <p className="mt-3 text-[11px] text-ink-muted">
          Um único resultado — a linha de evolução aparece no próximo exame.
        </p>
      )}
    </div>
  );
}
