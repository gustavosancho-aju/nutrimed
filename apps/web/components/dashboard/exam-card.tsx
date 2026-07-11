import {
  classifyExam,
  computeTrend,
  EXAM_STATUS_LABEL,
  type ExamMarker,
  type ExamStatus,
  type TrendPoint,
} from '@/lib/dashboard';
import { TrendChart } from './trend-chart';

/** Cor da faixa SEMPRE acompanhada do rótulo textual (acessibilidade/NFR10). */
const STATUS_BADGE: Record<ExamStatus, string> = {
  ok: 'border-emerald-300/50 bg-emerald-400/10 text-emerald-700',
  atencao: 'border-amber-300/60 bg-amber-400/10 text-amber-700',
  alerta: 'border-red-300/60 bg-red-400/10 text-red-700',
};
const CHART_TONE: Record<ExamStatus, string> = {
  ok: 'text-emerald-600',
  atencao: 'text-amber-600',
  alerta: 'text-red-600',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Card de exame laboratorial (E11/11.8): valor atual + faixa de referência
 * colorida (com rótulo) + evolução. A cor é apoio visual, não diagnóstico.
 * Exames PERSONALIZADOS (sem `marker`) não têm faixa conhecida: sem badge e
 * gráfico em tom neutro — não inventamos referência ("IA assiste, médico decide").
 */
export function ExamCard({
  label,
  marker,
  unit,
  reference,
  points,
}: {
  label: string;
  marker?: ExamMarker;
  unit?: string;
  reference?: string;
  points: readonly TrendPoint[];
}) {
  const trend = computeTrend(points);

  return (
    <div className="card-premium p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
        {unit && <span className="text-[11px] text-ink-muted">{unit}</span>}
      </div>

      {trend === null ? (
        <p className="mt-2 text-sm text-ink-muted">Sem exames lançados.</p>
      ) : (
        <>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-display text-2xl font-semibold text-ink">{fmt(trend.current)}</span>
            {marker && (() => {
              const status = classifyExam(marker, trend.current);
              return (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[status]}`}
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                  {EXAM_STATUS_LABEL[status]}
                </span>
              );
            })()}
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">
            {marker && reference
              ? `Referência: ${reference}`
              : 'Sem faixa de referência — interpretação do médico.'}
          </p>
          {points.length > 1 && (
            <div className="mt-3">
              <TrendChart
                points={points}
                className={marker ? CHART_TONE[classifyExam(marker, trend.current)] : 'text-brand'}
                unit={unit}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
