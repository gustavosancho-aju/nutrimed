import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import {
  loadPatient,
  listBodyComposition,
  listLabExam,
  computeAge,
} from '@nutrimed/patients';
import {
  type TrendPoint,
  deriveHeightMeters,
  idealWeightRange,
  idealWeightTarget,
  HEALTHY_IMC,
  TARGET_IMC,
} from '@/lib/dashboard';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ExamCard } from '@/components/dashboard/exam-card';
import { MeasurementForm } from '@/components/dashboard/measurement-form';

type Aba = 'geral' | 'bioimpedancia' | 'exames';
const ABAS: { key: Aba; label: string }[] = [
  { key: 'geral', label: 'Geral' },
  { key: 'bioimpedancia', label: 'Bioimpedância' },
  { key: 'exames', label: 'Exames' },
];

/** Extrai a série temporal de um campo das medições (ignora os ausentes). */
function seriesOf<T>(rows: readonly { measuredAt: Date; values: T }[], key: keyof T): TrendPoint[] {
  return rows
    .filter((r) => typeof r.values[key] === 'number')
    .map((r) => ({ measuredAt: r.measuredAt, value: r.values[key] as number }));
}

/**
 * Dashboard de evolução do paciente (E11 Fase 3) — 3 abas (Geral · Bioimpedância
 * · Exames) no design premium. Navegação por `?aba=` (server-side). Valida posse.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const { aba: abaRaw } = await searchParams;
  const aba: Aba = abaRaw === 'bioimpedancia' || abaRaw === 'exames' ? abaRaw : 'geral';

  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const body = await listBodyComposition(db, id, key);
  const labs = await listLabExam(db, id, key);
  const today = new Date().toISOString().slice(0, 10);
  const age = computeAge(patient.birthDate, new Date());

  // Parâmetros ideais (apoio visual, referência OMS): altura derivada da medição
  // mais recente que tenha peso + IMC juntos → faixa/meta de peso saudável.
  let heightM: number | null = null;
  for (let i = body.length - 1; i >= 0 && heightM === null; i -= 1) {
    heightM = deriveHeightMeters(body[i]!.values.peso, body[i]!.values.imc);
  }
  const pesoBand = heightM !== null ? idealWeightRange(heightM) : undefined;
  const pesoTarget = heightM !== null ? idealWeightTarget(heightM) : undefined;
  const pesoTargetLabel =
    pesoBand && pesoTarget !== undefined
      ? `Faixa ideal ${Math.round(pesoBand.min)}–${Math.round(pesoBand.max)} kg · meta ~${Math.round(pesoTarget)} kg`
      : undefined;
  const imcTargetLabel = `Saudável ${HEALTHY_IMC.min}–${HEALTHY_IMC.max} · meta ~${TARGET_IMC}`;

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-8">
      <header className="flex items-start justify-between gap-4 border-b border-ink/10 pb-5">
        <div>
          <Link href={`/patients/${id}`} className="text-sm text-ink-muted transition-colors hover:text-ink">
            ← {patient.name}
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
            Dashboard de evolução
          </h1>
          <p className="text-sm text-ink-muted">
            {patient.name}
            {age !== null ? ` · ${age} anos` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/patients/${id}/apresentacao`}
            className="rounded-[10px] bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            ✨ Apresentação
          </Link>
          <Link
            href={`/patients/${id}/import`}
            className="rounded-[10px] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            📄 Importar laudo (PDF)
          </Link>
        </div>
      </header>

      {/* Abas */}
      <nav className="mt-6 flex gap-1 border-b border-ink/10" aria-label="Seções da dashboard">
        {ABAS.map((t) => {
          const active = t.key === aba;
          return (
            <Link
              key={t.key}
              href={`/patients/${id}/dashboard?aba=${t.key}`}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* Conteúdo */}
      <section className="mt-6">
        {aba === 'geral' && (
          <div className="space-y-6">
            {patient.goal && (
              <div className="rounded-[12px] border border-brand/20 bg-brand/5 p-5">
                <p className="text-xs uppercase tracking-wide text-brand">Principal objetivo</p>
                <p className="mt-1 font-display text-lg font-semibold text-ink">{patient.goal}</p>
              </div>
            )}
            {heightM !== null && pesoBand && (
              <div className="rounded-[12px] border border-secondary/25 bg-secondary/[0.06] p-5">
                <p className="text-xs uppercase tracking-wide text-secondary">
                  Parâmetros ideais (referência)
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-ink-muted">Altura estimada</dt>
                    <dd className="mt-0.5 font-medium text-ink">{heightM.toFixed(2)} m</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">Idade</dt>
                    <dd className="mt-0.5 font-medium text-ink">{age !== null ? `${age} anos` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">Peso ideal</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {Math.round(pesoBand.min)}–{Math.round(pesoBand.max)} kg
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-muted">IMC saudável</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {HEALTHY_IMC.min}–{HEALTHY_IMC.max}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-[11px] text-ink-muted">
                  Estimativa por IMC (OMS); altura derivada de peso + IMC. Apoio visual — a conduta é do médico.
                </p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                label="Peso"
                points={seriesOf(body, 'peso')}
                unit="kg"
                band={pesoBand}
                target={pesoTarget}
                targetLabel={pesoTargetLabel}
              />
              <MetricCard label="Massa Muscular" points={seriesOf(body, 'massaMuscular')} unit="kg" />
              <MetricCard label="% Gordura" points={seriesOf(body, 'pgc')} unit="%" />
            </div>
            {body.length === 0 && (
              <p className="text-sm text-ink-muted">
                Ainda não há medições. Lance a primeira na aba Bioimpedância.
              </p>
            )}
          </div>
        )}

        {aba === 'bioimpedancia' && (
          <div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                label="Peso"
                points={seriesOf(body, 'peso')}
                unit="kg"
                band={pesoBand}
                target={pesoTarget}
                targetLabel={pesoTargetLabel}
              />
              <MetricCard label="Massa Muscular" points={seriesOf(body, 'massaMuscular')} unit="kg" />
              <MetricCard label="Massa de Gordura" points={seriesOf(body, 'massaGordura')} unit="kg" />
              <MetricCard label="Cintura Abdominal" points={seriesOf(body, 'cintura')} unit="cm" />
              <MetricCard
                label="IMC"
                points={seriesOf(body, 'imc')}
                band={HEALTHY_IMC}
                target={TARGET_IMC}
                targetLabel={imcTargetLabel}
              />
              <MetricCard label="PGC" points={seriesOf(body, 'pgc')} unit="%" />
            </div>
            <MeasurementForm
              patientId={id}
              kind="body"
              defaultDate={today}
              fields={[
                { name: 'peso', label: 'Peso', unit: 'kg' },
                { name: 'massaMuscular', label: 'Massa Muscular', unit: 'kg' },
                { name: 'massaGordura', label: 'Massa de Gordura', unit: 'kg' },
                { name: 'cintura', label: 'Cintura', unit: 'cm' },
                { name: 'imc', label: 'IMC' },
                { name: 'pgc', label: 'PGC', unit: '%' },
              ]}
            />
          </div>
        )}

        {aba === 'exames' && (
          <div>
            <div className="grid gap-4 sm:grid-cols-3">
              <ExamCard label="LDL" marker="ldl" unit="mg/dL" reference="< 100 ok · 100–159 atenção · ≥ 160 alerta" points={seriesOf(labs, 'ldl')} />
              <ExamCard label="HbA1C" marker="hba1c" unit="%" reference="< 5.7 ok · 5.7–6.4 atenção · ≥ 6.5 alerta" points={seriesOf(labs, 'hba1c')} />
              <ExamCard label="Insulina" marker="insulina" unit="µU/mL" reference="≤ 12 ok · 12–25 atenção · > 25 alerta" points={seriesOf(labs, 'insulina')} />
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              As faixas são referência simplificada de apoio visual — não constituem diagnóstico. A
              interpretação é do médico responsável.
            </p>
            <MeasurementForm
              patientId={id}
              kind="lab"
              defaultDate={today}
              fields={[
                { name: 'ldl', label: 'LDL', unit: 'mg/dL' },
                { name: 'hba1c', label: 'HbA1C', unit: '%' },
                { name: 'insulina', label: 'Insulina', unit: 'µU/mL' },
              ]}
            />
          </div>
        )}
      </section>
    </main>
  );
}
