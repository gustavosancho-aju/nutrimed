import Link from 'next/link';
import type { DailyNutritionDiary } from '@nutrimed/patients';
import {
  adherenceTrendPoints,
  classifyDailyStatus,
  type MonthlyNutritionSummary,
} from '@/lib/dashboard';
import { TrendChart } from './trend-chart';
import { GoalHitBadge } from './goal-hit-badge';

/**
 * Histórico mês a mês do plano de 12 meses (E15 fase 3) — a visão que o médico
 * usa para acompanhar e, depois, apresentar ao paciente.
 *
 * Duas leituras empilhadas: a RÉGUA dos 12 meses (a jornada inteira) e o MÊS
 * selecionado, dia a dia. Toda a matemática vem pronta de `summarizeNutritionMonths`
 * (puro e testado); aqui só há apresentação.
 *
 * Regra que a tela precisa respeitar (a mesma do agregado): aderência e cobertura
 * NUNCA se fundem num número só. "Bateu 10 de 12 dias registrados" e "registrou
 * 12 de 30 dias" contam histórias clínicas diferentes, e é o médico — não a
 * interface — quem tira a conclusão.
 */

const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
});
const WEEKDAY_LABEL = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });

function monthName(monthISO: string): string {
  return MONTH_LABEL.format(new Date(`${monthISO}-01T00:00:00Z`));
}

/** Cartão de um número do resumo, com o denominador sempre à vista. */
function SummaryStat({
  label,
  value,
  detail,
  tone = 'ink',
  testId,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'ink' | 'brand';
  testId?: string;
}) {
  return (
    <div className="rounded-[10px] border border-ink/10 bg-white p-4" data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${tone === 'brand' ? 'text-brand' : 'text-ink'}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-muted">{detail}</p>
    </div>
  );
}

export function MonthlyHistory({
  patientId,
  months,
  selectedMonth,
  monthDiary,
}: {
  patientId: string;
  /** Resumo dos 12 meses do plano, em ordem cronológica. */
  months: readonly MonthlyNutritionSummary[];
  /** `YYYY-MM` em exibição. */
  selectedMonth: string;
  /** Dias do mês selecionado (todos, inclusive os sem registro). */
  monthDiary: readonly DailyNutritionDiary[];
}) {
  const index = months.findIndex((m) => m.month === selectedMonth);
  const current = index >= 0 ? months[index] : undefined;
  const previous = index > 0 ? months[index - 1] : undefined;
  const next = index >= 0 && index < months.length - 1 ? months[index + 1] : undefined;
  const trend = adherenceTrendPoints(months);

  const link = (month: string) => `/patients/${patientId}/dashboard?aba=bem-estar&mes=${month}`;

  return (
    <section className="space-y-4">
      {/* ── Régua dos 12 meses ─────────────────────────────────────────── */}
      <div className="card-premium p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-ink">Aderência ao longo do plano</h3>
          <p className="text-[11px] text-ink-muted">
            % dos dias <strong>registrados</strong> em que bateu a meta · 12 meses
          </p>
        </div>
        {trend.length >= 1 ? (
          <div className="mt-3">
            <TrendChart points={trend} unit="%" heightClass="h-20" />
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            Ainda não há mês com registro suficiente para desenhar a evolução.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {months.map((m) => {
            const isCurrent = m.month === selectedMonth;
            return (
              <Link
                key={m.month}
                href={link(m.month)}
                className={`rounded-[8px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isCurrent
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-ink/12 text-ink-muted hover:bg-surface-muted'
                }`}
                title={
                  m.adherencePct === null
                    ? 'Sem dias avaliáveis neste mês'
                    : `${m.adherencePct}% de aderência · ${m.coveragePct}% de cobertura`
                }
              >
                {m.month.slice(5)}/{m.month.slice(2, 4)}
                <span className="ml-1 text-ink-muted">
                  {m.adherencePct === null ? '—' : `${m.adherencePct}%`}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Mês selecionado ────────────────────────────────────────────── */}
      <div className="card-premium p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-semibold capitalize text-ink">
            {monthName(selectedMonth)}
          </h3>
          <div className="flex items-center gap-2">
            {previous ? (
              <Link
                href={link(previous.month)}
                className="rounded-[8px] border border-ink/15 px-2.5 py-1 text-xs text-ink transition-colors hover:bg-surface-muted"
              >
                ◀ {monthName(previous.month).split(' ')[0]}
              </Link>
            ) : (
              <span className="rounded-[8px] border border-ink/8 px-2.5 py-1 text-xs text-ink-muted/50">◀</span>
            )}
            {next ? (
              <Link
                href={link(next.month)}
                className="rounded-[8px] border border-ink/15 px-2.5 py-1 text-xs text-ink transition-colors hover:bg-surface-muted"
              >
                {monthName(next.month).split(' ')[0]} ▶
              </Link>
            ) : (
              <span className="rounded-[8px] border border-ink/8 px-2.5 py-1 text-xs text-ink-muted/50">▶</span>
            )}
          </div>
        </div>

        {current && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryStat
              label="Aderência"
              tone="brand"
              testId="stat-aderencia"
              value={current.adherencePct === null ? '—' : `${current.adherencePct}%`}
              detail={
                current.evaluatedDays === 0
                  ? 'Nenhum dia avaliável'
                  : `Bateu em ${current.daysHitGoal} de ${current.evaluatedDays} dias avaliados`
              }
            />
            <SummaryStat
              label="Cobertura"
              value={`${current.coveragePct}%`}
              detail={`Registrou ${current.daysWithRecord} de ${current.daysInMonth} dias`}
            />
            <SummaryStat
              label="Média consumida"
              value={current.avgKcal === null ? '—' : `${Math.round(current.avgKcal)}`}
              detail="kcal/dia, nos dias com registro"
            />
            <SummaryStat
              label="Meta média"
              value={current.avgGoalKcal === null ? '—' : `${Math.round(current.avgGoalKcal)}`}
              detail="kcal/dia definida pelo médico"
            />
          </div>
        )}

        {current && current.coveragePct < 100 && current.adherencePct !== null && (
          <p className="mt-3 rounded-[8px] border border-secondary/25 bg-secondary/[0.06] px-3 py-2 text-[11px] text-ink-muted">
            A aderência considera apenas os dias avaliados. Os {current.daysInMonth - current.daysWithRecord}{' '}
            dias sem registro não contam como meta perdida — não há dado para julgar.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
          {monthDiary.map((d) => {
            const hasData = d.entries.length > 0;
            const status = classifyDailyStatus(hasData, d.progress.consumed.kcal, d.progress.goal?.kcal);
            const at = new Date(`${d.day}T00:00:00Z`);
            return (
              <div
                key={d.day}
                data-testid="day-cell"
                data-status={status}
                className={`rounded-[8px] border px-2 py-1.5 ${
                  hasData ? 'border-ink/12 bg-white' : 'border-dashed border-ink/10 bg-surface'
                }`}
                title={
                  hasData
                    ? `${Math.round(d.progress.consumed.kcal)} kcal${
                        d.progress.goal ? ` de ${Math.round(d.progress.goal.kcal)}` : ' (sem meta)'
                      }`
                    : 'Sem registro nesse dia'
                }
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-mono-data text-[11px] text-ink">{DAY_LABEL.format(at)}</span>
                  <GoalHitBadge status={status} />
                </div>
                <p className="text-[10px] capitalize text-ink-muted">
                  {WEEKDAY_LABEL.format(at).replace('.', '')}
                  {hasData && ` · ${Math.round(d.progress.consumed.kcal)}`}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
