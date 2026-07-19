import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import {
  loadPatient,
  listBodyComposition,
  listLabExam,
  loadCustomExamDefs,
  loadCurrentBodyGoal,
  computeAge,
} from '@nutrimed/patients';
import {
  compareTrendPoints,
  deriveHeightMeters,
  idealWeightRange,
  idealWeightTarget,
  seriesOf,
  HEALTHY_IMC,
  TARGET_IMC,
  type TrendPoint,
  type TargetBand,
} from '@/lib/dashboard';
import { BodySimulator } from '@/components/dashboard/body-simulator';
import { ImcScale } from '@/components/dashboard/imc-scale';
import { TrendChart } from '@/components/dashboard/trend-chart';

/**
 * Modo APRESENTAÇÃO (tela paralela à dashboard): visual premium para o médico
 * virar a tela ao paciente. Figura corporal paramétrica (estado atual por IMC),
 * régua de classificação OMS, números grandes e evolução resumida. Tudo apoio
 * visual — a interpretação e a conduta são do médico (NFR10).
 */

function fmt(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

/** Último valor presente de um campo nas medições (ordenadas por data ASC). */
function lastOf<T>(rows: readonly { values: T }[], key: keyof T): number | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = rows[i]!.values[key];
    if (typeof v === 'number') return v;
  }
  return null;
}

/** Primeiro valor presente de um campo (baseline da evolução). */
function firstOf<T>(rows: readonly { values: T }[], key: keyof T): number | null {
  for (const r of rows) {
    const v = r.values[key];
    if (typeof v === 'number') return v;
  }
  return null;
}

/** dd/mm/aa (pt-BR) para o período das medições sob cada gráfico. */
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

/** Cartão de gráfico do modo apresentação (linha + pontos + banda/meta). */
function EvolutionChart({
  label,
  points,
  unit,
  band,
  target,
}: {
  label: string;
  points: readonly TrendPoint[];
  unit?: string;
  band?: TargetBand;
  target?: number;
}) {
  if (points.length === 0) return null;
  const sorted = [...points].sort(compareTrendPoints);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return (
    <div className="rounded-[12px] border border-ink/10 bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="font-display text-lg font-semibold text-ink">
          {Number.isInteger(last.value) ? last.value : last.value.toFixed(1)}
          {unit && <span className="ml-1 text-xs font-normal text-ink-muted">{unit}</span>}
        </p>
      </div>
      <div className="mt-3">
        <TrendChart points={points} unit={unit} band={band} target={target} heightClass="h-24" />
      </div>
      <p className="mt-2 flex justify-between text-[10px] text-ink-muted" aria-hidden>
        <span>{fmtDate(first.measuredAt)}</span>
        <span>
          {sorted.length} {sorted.length === 1 ? 'medição' : 'medições'}
        </span>
        <span>{fmtDate(last.measuredAt)}</span>
      </p>
    </div>
  );
}

export default async function ApresentacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const body = await listBodyComposition(db, id, key);
  const labs = await listLabExam(db, id, key);
  const customDefs = await loadCustomExamDefs(db, id, key);
  const bodyGoal = await loadCurrentBodyGoal(db, id, key);
  const age = computeAge(patient.birthDate, new Date());

  const peso = lastOf(body, 'peso');
  const imc = lastOf(body, 'imc');
  const pgc = lastOf(body, 'pgc');
  const massaMuscular = lastOf(body, 'massaMuscular');
  const pesoInicial = firstOf(body, 'peso');
  const deltaPeso = peso !== null && pesoInicial !== null && body.length > 1 ? peso - pesoInicial : null;

  // Altura derivada da medição mais recente com peso+IMC (mesma regra da dashboard).
  let heightM: number | null = null;
  for (let i = body.length - 1; i >= 0 && heightM === null; i -= 1) {
    heightM = deriveHeightMeters(body[i]!.values.peso, body[i]!.values.imc);
  }
  const faixaPeso = heightM !== null ? idealWeightRange(heightM) : null;
  const metaPesoOms = heightM !== null ? idealWeightTarget(heightM) : null;

  // Metas do médico (body_goal) têm precedência; Peso e IMC caem na OMS.
  const goal = bodyGoal?.values;
  const metaPeso = goal?.peso ?? metaPesoOms;
  const metaImc = goal?.imc ?? TARGET_IMC;

  const stats: { label: string; value: string; hint?: string }[] = [
    { label: 'Peso atual', value: peso !== null ? `${fmt(peso)} kg` : '—' },
    {
      label: 'Peso ideal',
      value: faixaPeso ? `${Math.round(faixaPeso.min)}–${Math.round(faixaPeso.max)} kg` : '—',
      hint:
        goal?.peso !== undefined
          ? `meta ${fmt(goal.peso)} kg (definida pelo médico)`
          : metaPesoOms !== null
            ? `meta ~${Math.round(metaPesoOms)} kg`
            : undefined,
    },
    { label: 'Massa muscular', value: massaMuscular !== null ? `${fmt(massaMuscular)} kg` : '—' },
    { label: '% Gordura', value: pgc !== null ? `${fmt(pgc)} %` : '—' },
    { label: 'Altura estimada', value: heightM !== null ? `${heightM.toFixed(2)} m` : '—' },
    { label: 'Idade', value: age !== null ? `${age} anos` : '—' },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-8">
      <header className="flex items-start justify-between gap-4 pb-4">
        <div>
          <Link
            href={`/patients/${id}/dashboard`}
            className="text-sm text-ink-muted transition-colors hover:text-ink"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink">
            {patient.name}
          </h1>
          {patient.goal && <p className="mt-0.5 text-sm text-ink-muted">Objetivo: {patient.goal}</p>}
        </div>
      </header>

      {body.length === 0 ? (
        <section className="card-premium gold-hairline mt-6 p-10 text-center">
          <h2 className="font-display text-lg font-semibold text-ink">Sem medições ainda</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            Lance a primeira bioimpedância na dashboard para a apresentação ganhar vida.
          </p>
          <Link
            href={`/patients/${id}/dashboard?aba=bioimpedancia`}
            className="mt-5 inline-block rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Lançar medição
          </Link>
        </section>
      ) : (
        <section className="card-premium gold-hairline mt-4 overflow-hidden">
          <div className="grid gap-8 p-8 md:grid-cols-[280px_1fr] md:p-10">
            {/* Figura corporal (atual + contorno da meta + simulação por peso) */}
            <div className="flex flex-col items-center justify-center">
              {imc !== null ? (
                <BodySimulator
                  imcAtual={imc}
                  pesoAtual={peso}
                  heightM={heightM}
                  metaPeso={metaPeso ?? null}
                  metaDefinidaPeloMedico={goal?.peso !== undefined}
                />
              ) : (
                <p className="text-sm text-ink-muted">
                  Lance o IMC para visualizar a figura corporal.
                </p>
              )}
            </div>

            {/* Números de apresentação */}
            <div className="min-w-0">
              {imc !== null && (
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">IMC atual</p>
                    <p className="font-display text-6xl font-semibold leading-none text-ink">
                      {fmt(imc)}
                    </p>
                  </div>
                  {deltaPeso !== null && (
                    <p className="mb-1 text-sm text-ink-muted">
                      <span aria-hidden>{deltaPeso > 0 ? '▲' : deltaPeso < 0 ? '▼' : '–'}</span>{' '}
                      {fmt(Math.abs(deltaPeso))} kg desde a 1ª avaliação
                    </p>
                  )}
                </div>
              )}

              {imc !== null && (
                <div className="mt-6">
                  <ImcScale imc={imc} />
                </div>
              )}

              <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-[12px] border border-ink/10 bg-surface p-4">
                    <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{s.label}</dt>
                    <dd className="mt-1 font-display text-xl font-semibold text-ink">{s.value}</dd>
                    {s.hint && <dd className="mt-0.5 text-[11px] text-ink-muted">{s.hint}</dd>}
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* Evolução — linhas com os pontos das medições */}
          <div className="border-t border-ink/10 px-8 pb-8 pt-6 md:px-10">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-base font-semibold text-ink">Evolução</h2>
              {body.length === 1 && (
                <p className="text-[11px] text-ink-muted">
                  Ponto atual marcado — a linha se forma a partir da 2ª medição.
                </p>
              )}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <EvolutionChart
                label="Peso"
                points={seriesOf(body, 'peso')}
                unit="kg"
                band={faixaPeso ?? undefined}
                target={metaPeso ?? undefined}
              />
              <EvolutionChart
                label="IMC"
                points={seriesOf(body, 'imc')}
                band={HEALTHY_IMC}
                target={metaImc}
              />
              <EvolutionChart
                label="Massa Muscular"
                points={seriesOf(body, 'massaMuscular')}
                unit="kg"
                target={goal?.massaMuscular}
              />
              <EvolutionChart
                label="% Gordura"
                points={seriesOf(body, 'pgc')}
                unit="%"
                target={goal?.pgc}
              />
              <EvolutionChart
                label="Massa de Gordura"
                points={seriesOf(body, 'massaGordura')}
                unit="kg"
                target={goal?.massaGordura}
              />
              <EvolutionChart
                label="Cintura Abdominal"
                points={seriesOf(body, 'cintura')}
                unit="cm"
                target={goal?.cintura}
              />
            </div>
          </div>

          {/* Exames laboratoriais — evolução (sem banda/meta: não inventamos
              referência visual na tela do paciente; a interpretação é do médico) */}
          {labs.length > 0 && (
            <div className="border-t border-ink/10 px-8 pb-8 pt-6 md:px-10">
              <h2 className="font-display text-base font-semibold text-ink">
                Exames laboratoriais
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <EvolutionChart label="LDL" points={seriesOf(labs, 'ldl')} unit="mg/dL" />
                <EvolutionChart label="HbA1C" points={seriesOf(labs, 'hba1c')} unit="%" />
                <EvolutionChart label="Insulina" points={seriesOf(labs, 'insulina')} unit="µU/mL" />
                {customDefs.map((d) => (
                  <EvolutionChart
                    key={d.slot}
                    label={d.name}
                    points={seriesOf(labs, `custom${d.slot}` as 'custom1' | 'custom2' | 'custom3')}
                    unit={d.unit}
                  />
                ))}
              </div>
            </div>
          )}

          <p className="border-t border-ink/10 bg-surface-muted/60 px-8 py-3 text-center text-[11px] text-ink-muted">
            Figura e faixas (OMS) são apoio visual de apresentação — não constituem diagnóstico. A
            conduta é do médico responsável.
          </p>
        </section>
      )}
    </main>
  );
}
