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
  seriesOf,
  deriveHeightMeters,
  idealWeightRange,
  idealWeightTarget,
  HEALTHY_IMC,
  TARGET_IMC,
} from '@/lib/dashboard';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ExamCard } from '@/components/dashboard/exam-card';
import { MeasurementForm } from '@/components/dashboard/measurement-form';
import { MeasurementHistory } from '@/components/dashboard/measurement-history';
import { CustomExamSettings } from '@/components/dashboard/custom-exam-settings';
import { BodyGoalSettings } from '@/components/dashboard/body-goal-settings';

type Aba = 'geral' | 'bioimpedancia' | 'exames';
const ABAS: { key: Aba; label: string }[] = [
  { key: 'geral', label: 'Geral' },
  { key: 'bioimpedancia', label: 'Bioimpedância' },
  { key: 'exames', label: 'Exames' },
];

/**
 * Dashboard de evolução do paciente (E11 Fase 3) — 3 abas (Geral · Bioimpedância
 * · Exames) no design premium. Navegação por `?aba=` (server-side). Valida posse.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; erro?: string; editar?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const { aba: abaRaw, erro, editar } = await searchParams;
  const aba: Aba = abaRaw === 'bioimpedancia' || abaRaw === 'exames' ? abaRaw : 'geral';

  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const body = await listBodyComposition(db, id, key);
  const labs = await listLabExam(db, id, key);
  const customDefs = await loadCustomExamDefs(db, id, key);
  const bodyGoal = await loadCurrentBodyGoal(db, id, key);
  const today = new Date().toISOString().slice(0, 10);
  const age = computeAge(patient.birthDate, new Date());

  // Campos das abas (form + histórico compartilham a mesma definição)
  const bodyFields = [
    { name: 'peso', label: 'Peso', unit: 'kg' },
    { name: 'massaMuscular', label: 'Massa Muscular', unit: 'kg' },
    { name: 'massaGordura', label: 'Massa de Gordura', unit: 'kg' },
    { name: 'cintura', label: 'Cintura', unit: 'cm' },
    { name: 'imc', label: 'IMC' },
    { name: 'pgc', label: 'PGC', unit: '%' },
  ] as const;
  const labFields = [
    { name: 'ldl', label: 'LDL', unit: 'mg/dL' },
    { name: 'hba1c', label: 'HbA1C', unit: '%' },
    { name: 'insulina', label: 'Insulina', unit: 'µU/mL' },
    ...customDefs.map((d) => ({ name: `custom${d.slot}`, label: d.name, unit: d.unit })),
  ];

  // Modo edição (?editar=<id>): pré-preenche o form da aba com a medição
  const editingBody = aba === 'bioimpedancia' && editar ? body.find((m) => m.id === editar) : undefined;
  const editingLab = aba === 'exames' && editar ? labs.find((m) => m.id === editar) : undefined;

  // Parâmetros ideais (apoio visual, referência OMS): altura derivada da medição
  // mais recente que tenha peso + IMC juntos → faixa/meta de peso saudável.
  let heightM: number | null = null;
  for (let i = body.length - 1; i >= 0 && heightM === null; i -= 1) {
    heightM = deriveHeightMeters(body[i]!.values.peso, body[i]!.values.imc);
  }
  const pesoBand = heightM !== null ? idealWeightRange(heightM) : undefined;
  const pesoTargetOms = heightM !== null ? idealWeightTarget(heightM) : undefined;

  // Metas do médico (body_goal) têm precedência; Peso e IMC caem na referência
  // OMS como padrão. Demais métricas só têm meta quando o médico define.
  const goal = bodyGoal?.values;
  const doctorLabel = 'Meta definida pelo médico';
  const pesoTarget = goal?.peso ?? pesoTargetOms;
  const imcTarget = goal?.imc ?? TARGET_IMC;
  const pesoTargetLabel =
    goal?.peso !== undefined
      ? `${doctorLabel}${pesoBand ? ` · faixa ideal ${Math.round(pesoBand.min)}–${Math.round(pesoBand.max)} kg` : ''}`
      : pesoBand && pesoTargetOms !== undefined
        ? `Faixa ideal ${Math.round(pesoBand.min)}–${Math.round(pesoBand.max)} kg · meta ~${Math.round(pesoTargetOms)} kg`
        : undefined;
  const imcTargetLabel =
    goal?.imc !== undefined
      ? `${doctorLabel} · saudável ${HEALTHY_IMC.min}–${HEALTHY_IMC.max}`
      : `Saudável ${HEALTHY_IMC.min}–${HEALTHY_IMC.max} · meta ~${TARGET_IMC}`;

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

      {erro && (
        <p
          role="alert"
          className="mt-6 rounded-[10px] border border-red-300/60 bg-red-400/10 px-4 py-2.5 text-sm text-red-700"
        >
          {erro}
        </p>
      )}

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
              <MetricCard
                label="Massa Muscular"
                points={seriesOf(body, 'massaMuscular')}
                unit="kg"
                target={goal?.massaMuscular}
                targetLabel={goal?.massaMuscular !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="% Gordura"
                points={seriesOf(body, 'pgc')}
                unit="%"
                target={goal?.pgc}
                targetLabel={goal?.pgc !== undefined ? doctorLabel : undefined}
              />
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
              <MetricCard
                label="Massa Muscular"
                points={seriesOf(body, 'massaMuscular')}
                unit="kg"
                target={goal?.massaMuscular}
                targetLabel={goal?.massaMuscular !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Massa de Gordura"
                points={seriesOf(body, 'massaGordura')}
                unit="kg"
                target={goal?.massaGordura}
                targetLabel={goal?.massaGordura !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Cintura Abdominal"
                points={seriesOf(body, 'cintura')}
                unit="cm"
                target={goal?.cintura}
                targetLabel={goal?.cintura !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="IMC"
                points={seriesOf(body, 'imc')}
                band={HEALTHY_IMC}
                target={imcTarget}
                targetLabel={imcTargetLabel}
              />
              <MetricCard
                label="PGC"
                points={seriesOf(body, 'pgc')}
                unit="%"
                target={goal?.pgc}
                targetLabel={goal?.pgc !== undefined ? doctorLabel : undefined}
              />
            </div>
            <MeasurementForm
              patientId={id}
              kind="body"
              defaultDate={editingBody ? editingBody.measuredAt.toISOString().slice(0, 10) : today}
              fields={bodyFields}
              measurementId={editingBody?.id}
              defaults={editingBody ? { ...editingBody.values } : undefined}
              title={editingBody ? 'Editar medição' : 'Nova medição'}
            />
            <MeasurementHistory
              patientId={id}
              kind="body"
              aba="bioimpedancia"
              fields={bodyFields}
              measurements={body}
            />
            <BodyGoalSettings patientId={id} goal={bodyGoal} defaultDate={today} />
          </div>
        )}

        {aba === 'exames' && (
          <div>
            <div className="grid gap-4 sm:grid-cols-3">
              <ExamCard label="LDL" marker="ldl" unit="mg/dL" reference="< 100 ok · 100–159 atenção · ≥ 160 alerta" points={seriesOf(labs, 'ldl')} />
              <ExamCard label="HbA1C" marker="hba1c" unit="%" reference="< 5.7 ok · 5.7–6.4 atenção · ≥ 6.5 alerta" points={seriesOf(labs, 'hba1c')} />
              <ExamCard label="Insulina" marker="insulina" unit="µU/mL" reference="≤ 12 ok · 12–25 atenção · > 25 alerta" points={seriesOf(labs, 'insulina')} />
              {customDefs.map((d) => (
                <ExamCard
                  key={d.slot}
                  label={d.name}
                  unit={d.unit}
                  points={seriesOf(labs, `custom${d.slot}` as 'custom1' | 'custom2' | 'custom3')}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              As faixas são referência simplificada de apoio visual — não constituem diagnóstico. A
              interpretação é do médico responsável.
            </p>
            <MeasurementForm
              patientId={id}
              kind="lab"
              defaultDate={editingLab ? editingLab.measuredAt.toISOString().slice(0, 10) : today}
              fields={labFields}
              measurementId={editingLab?.id}
              defaults={editingLab ? { ...editingLab.values } : undefined}
              title={editingLab ? 'Editar medição' : 'Nova medição'}
            />
            <MeasurementHistory
              patientId={id}
              kind="lab"
              aba="exames"
              fields={labFields}
              measurements={labs}
            />
            <CustomExamSettings patientId={id} defs={customDefs} />
          </div>
        )}
      </section>
    </main>
  );
}
