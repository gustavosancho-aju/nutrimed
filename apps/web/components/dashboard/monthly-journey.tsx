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
 * Jornada mês a mês no Modo Apresentação (E15 fase 4) — a MESMA verdade do
 * dashboard, com outro enquadramento: quem lê aqui é o PACIENTE, ao lado do
 * médico, mês a mês ao longo do plano de 12 meses.
 *
 * Diferenças deliberadas em relação ao `<MonthlyHistory>` (a versão de trabalho
 * do médico), que é por que este componente existe em vez de um `variant`:
 *
 * - Frase em vez de painel de números. "Você bateu a meta em 10 dos 12 dias que
 *   registrou" comunica ao paciente o que quatro cartões com denominadores não
 *   comunicam.
 * - A cobertura NUNCA é apresentada como culpa. Ela é dita como fato e com a
 *   razão de existir ("quanto mais registros, mais fiel o retrato") — omitir
 *   seria desonesto, cobrar seria contraproducente na consulta.
 * - Sem ações, sem chips densos, tipografia maior: a tela é para ser lida a
 *   dois, possivelmente projetada.
 */

const MONTH_LONG = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long' });
const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const DAY_NUM = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit' });

function monthOnly(monthISO: string): string {
  return MONTH_LONG.format(new Date(`${monthISO}-01T00:00:00Z`));
}
function monthAndYear(monthISO: string): string {
  return MONTH_YEAR.format(new Date(`${monthISO}-01T00:00:00Z`));
}

export function MonthlyJourney({
  patientId,
  months,
  selectedMonth,
  monthDiary,
}: {
  patientId: string;
  months: readonly MonthlyNutritionSummary[];
  selectedMonth: string;
  monthDiary: readonly DailyNutritionDiary[];
}) {
  const index = months.findIndex((m) => m.month === selectedMonth);
  const current = index >= 0 ? months[index] : undefined;
  const previous = index > 0 ? months[index - 1] : undefined;
  const next = index >= 0 && index < months.length - 1 ? months[index + 1] : undefined;
  const trend = adherenceTrendPoints(months);
  const link = (month: string) => `/patients/${patientId}/apresentacao?mes=${month}`;

  // Nada registrado no plano inteiro ⇒ a seção não aparece (não se apresenta
  // uma tela vazia ao paciente).
  if (trend.length === 0 && monthDiary.every((d) => d.entries.length === 0)) return null;

  return (
    <div className="border-t border-ink/10 px-8 pb-8 pt-6 md:px-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-base font-semibold text-ink">Sua alimentação ao longo do plano</h2>
        <p className="text-[11px] text-ink-muted">Metas batidas mês a mês</p>
      </div>

      {trend.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-ink/10 bg-surface p-5">
          <TrendChart points={trend} unit="%" heightClass="h-28" />
        </div>
      )}

      {/* ── O mês em foco ───────────────────────────────────────────────── */}
      <div className="mt-6 rounded-[12px] border border-ink/10 bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold capitalize text-ink">
            {monthAndYear(selectedMonth)}
          </h3>
          <div className="flex items-center gap-2 text-xs">
            {previous ? (
              <Link
                href={link(previous.month)}
                className="rounded-[10px] border border-ink/15 bg-white px-3 py-1.5 capitalize text-ink transition-colors hover:bg-surface-muted"
              >
                ◀ {monthOnly(previous.month)}
              </Link>
            ) : null}
            {next ? (
              <Link
                href={link(next.month)}
                className="rounded-[10px] border border-ink/15 bg-white px-3 py-1.5 capitalize text-ink transition-colors hover:bg-surface-muted"
              >
                {monthOnly(next.month)} ▶
              </Link>
            ) : null}
          </div>
        </div>

        {current && (
          <>
            {current.adherencePct !== null ? (
              <p className="mt-4 font-display text-2xl leading-snug text-ink">
                Você bateu a meta em{' '}
                <strong className="text-brand">
                  {current.daysHitGoal} {current.daysHitGoal === 1 ? 'dia' : 'dias'}
                </strong>{' '}
                dos {current.evaluatedDays} que registrou
                <span className="text-ink-muted"> — {current.adherencePct}%.</span>
              </p>
            ) : (
              <p className="mt-4 font-display text-xl leading-snug text-ink-muted">
                Ainda não há registros suficientes neste mês para medir as metas.
              </p>
            )}

            <p className="mt-2 text-sm text-ink-muted">
              Registrou {current.daysWithRecord} de {current.daysInMonth} dias
              {current.daysWithRecord < current.daysInMonth &&
                ' — quanto mais registros, mais fiel fica o retrato do mês.'}
            </p>

            {current.avgKcal !== null && current.avgGoalKcal !== null && (
              <p className="mt-1 text-sm text-ink-muted">
                Média de {Math.round(current.avgKcal)} kcal por dia registrado, para uma meta de{' '}
                {Math.round(current.avgGoalKcal)} kcal.
              </p>
            )}
          </>
        )}

        {/* Grade do mês — o dia é o protagonista, sem número de caloria por cima */}
        <div className="mt-5 grid grid-cols-7 gap-1.5 sm:grid-cols-10">
          {monthDiary.map((d) => {
            const hasData = d.entries.length > 0;
            const status = classifyDailyStatus(hasData, d.progress.consumed.kcal, d.progress.goal?.kcal);
            return (
              <div
                key={d.day}
                data-testid="journey-day"
                data-status={status}
                className={`flex flex-col items-center rounded-[8px] border px-1 py-1.5 ${
                  hasData ? 'border-ink/12 bg-white' : 'border-dashed border-ink/10 bg-transparent'
                }`}
                title={
                  hasData
                    ? `${Math.round(d.progress.consumed.kcal)} kcal`
                    : 'Sem registro nesse dia'
                }
              >
                <span className="font-mono-data text-[11px] text-ink-muted">
                  {DAY_NUM.format(new Date(`${d.day}T00:00:00Z`))}
                </span>
                <GoalHitBadge status={status} />
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] text-ink-muted">
          ✓ meta batida · ✗ fora da meta · — sem registro. Os valores vêm dos registros do
          paciente e são aproximados.
        </p>
      </div>
    </div>
  );
}
