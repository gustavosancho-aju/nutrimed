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
  loadCurrentNutritionGoal,
  listWaterHistory,
  listSleepSessions,
  listNutritionDiary,
  sleepTargetFromGoal,
  computeAge,
  type DailyNutritionDiary,
  type SleepSession,
} from '@nutrimed/patients';
import {
  seriesOf,
  deriveHeightMeters,
  idealWeightRange,
  idealWeightTarget,
  HEALTHY_IMC,
  TARGET_IMC,
  lastNDaysISO,
  toLocalDayISO,
  classifyDailyStatus,
} from '@/lib/dashboard';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ExamCard } from '@/components/dashboard/exam-card';
import { MeasurementForm } from '@/components/dashboard/measurement-form';
import { MeasurementHistory } from '@/components/dashboard/measurement-history';
import { CustomExamSettings } from '@/components/dashboard/custom-exam-settings';
import { BodyGoalSettings } from '@/components/dashboard/body-goal-settings';
import { GoalHitBadge } from '@/components/dashboard/goal-hit-badge';
import { deleteFoodLogAction } from '@/lib/measurement-actions';

type Aba = 'geral' | 'bioimpedancia' | 'exames' | 'bem-estar';
const ABAS: { key: Aba; label: string }[] = [
  { key: 'geral', label: 'Geral' },
  { key: 'bioimpedancia', label: 'Bioimpedância' },
  { key: 'exames', label: 'Exames' },
  { key: 'bem-estar', label: 'Bem-estar' },
];

/** Fuso padrão do piloto (BR, UTC-3) — mesmo default do bot de Telegram. */
const BR_TZ_OFFSET_MINUTES = -180;
/** Janela do gráfico de água/sono no dashboard. */
const WELLNESS_HISTORY_DAYS = 14;

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
  const aba: Aba =
    abaRaw === 'bioimpedancia' || abaRaw === 'exames' || abaRaw === 'bem-estar' ? abaRaw : 'geral';

  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const body = await listBodyComposition(db, id, key);
  const labs = await listLabExam(db, id, key);
  const customDefs = await loadCustomExamDefs(db, id, key);
  const bodyGoal = await loadCurrentBodyGoal(db, id, key);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const age = computeAge(patient.birthDate, now);

  // Bem-estar (água/sono via Telegram): só busca quando a aba está ativa —
  // listWaterHistory faz uma query por dia (14), custo desnecessário nas
  // outras abas.
  const nutritionGoal = aba === 'bem-estar' ? await loadCurrentNutritionGoal(db, id, key) : null;
  const sleepTarget = sleepTargetFromGoal(nutritionGoal?.values);
  const wellnessDays = lastNDaysISO(now, WELLNESS_HISTORY_DAYS, BR_TZ_OFFSET_MINUTES);
  const waterHistory =
    aba === 'bem-estar' ? await listWaterHistory(db, id, wellnessDays, BR_TZ_OFFSET_MINUTES, key) : [];
  const sleepSessions =
    aba === 'bem-estar'
      ? await listSleepSessions(
          db,
          id,
          new Date(now.getTime() - WELLNESS_HISTORY_DAYS * 24 * 60 * 60 * 1000),
          sleepTarget,
        )
      : [];
  const nutritionDiary: DailyNutritionDiary[] =
    aba === 'bem-estar' ? await listNutritionDiary(db, id, wellnessDays, BR_TZ_OFFSET_MINUTES, key) : [];

  // Relatório diário (pedido do médico): uma linha por dia, mais recente
  // primeiro, cruzando alimentação + água + sono num único "bateu a meta?".
  const sleepByDay = new Map<string, SleepSession>();
  for (const s of sleepSessions) sleepByDay.set(toLocalDayISO(s.end, BR_TZ_OFFSET_MINUTES), s);
  const dailyReport = [...wellnessDays].reverse().map((day, idx) => {
    const i = wellnessDays.length - 1 - idx;
    const diary = nutritionDiary[i];
    const water = waterHistory[i];
    return { day, diary, water, sleep: sleepByDay.get(day) ?? null };
  });
  const hasAnyWellnessData =
    nutritionDiary.some((d) => d.entries.length > 0) ||
    waterHistory.some((p) => p.consumedMl > 0) ||
    sleepSessions.length > 0;

  // Campos das abas (form + histórico compartilham a mesma definição)
  const bodyFields = [
    { name: 'peso', label: 'Peso', unit: 'kg' },
    { name: 'massaMuscular', label: 'Massa Muscular', unit: 'kg' },
    { name: 'massaGordura', label: 'Massa de Gordura', unit: 'kg' },
    { name: 'cintura', label: 'Cintura', unit: 'cm' },
    { name: 'imc', label: 'IMC' },
    { name: 'pgc', label: 'PGC', unit: '%' },
    { name: 'aguaCorporal', label: 'Água Corporal', unit: 'L' },
    { name: 'gorduraVisceral', label: 'Gordura Visceral' },
    { name: 'tmb', label: 'TMB', unit: 'kcal' },
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

  // Parâmetros ideais (apoio visual, referência OMS). Altura: a informada no
  // cadastro tem precedência; sem ela, deriva da medição mais recente com
  // peso + IMC juntos (comportamento anterior como fallback).
  let heightM: number | null = patient.heightCm !== null ? patient.heightCm / 100 : null;
  const heightFromRegistration = heightM !== null;
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
    <main className="mx-auto min-h-screen max-w-[1880px] p-8 xl:text-lg">
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
                    <dt className="text-xs text-ink-muted">
                      {heightFromRegistration ? 'Altura' : 'Altura estimada'}
                    </dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {heightM.toFixed(2)} m
                      {!heightFromRegistration && (
                        <Link
                          href={`/patients/${id}/edit`}
                          className="ml-2 text-xs text-ink-muted underline hover:text-ink"
                        >
                          editar
                        </Link>
                      )}
                    </dd>
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
            {/* 5 métricas no formato pedido pelo piloto: Peso · IMC · % Gordura ·
                Massa Muscular · Cintura */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <MetricCard
                label="Peso"
                points={seriesOf(body, 'peso')}
                unit="kg"
                band={pesoBand}
                target={pesoTarget}
                targetLabel={pesoTargetLabel}
              />
              <MetricCard
                label="IMC"
                points={seriesOf(body, 'imc')}
                band={HEALTHY_IMC}
                target={imcTarget}
                targetLabel={imcTargetLabel}
              />
              <MetricCard
                label="% Gordura"
                points={seriesOf(body, 'pgc')}
                unit="%"
                target={goal?.pgc}
                targetLabel={goal?.pgc !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Massa Muscular"
                points={seriesOf(body, 'massaMuscular')}
                unit="kg"
                target={goal?.massaMuscular}
                targetLabel={goal?.massaMuscular !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Cintura"
                points={seriesOf(body, 'cintura')}
                unit="cm"
                target={goal?.cintura}
                targetLabel={goal?.cintura !== undefined ? doctorLabel : undefined}
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
              <MetricCard
                label="Água Corporal"
                points={seriesOf(body, 'aguaCorporal')}
                unit="L"
                target={goal?.aguaCorporal}
                targetLabel={goal?.aguaCorporal !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Gordura Visceral"
                points={seriesOf(body, 'gorduraVisceral')}
                target={goal?.gorduraVisceral}
                targetLabel={goal?.gorduraVisceral !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="TMB"
                points={seriesOf(body, 'tmb')}
                unit="kcal"
                target={goal?.tmb}
                targetLabel={goal?.tmb !== undefined ? doctorLabel : undefined}
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

        {aba === 'bem-estar' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 rounded-[12px] border border-secondary/25 bg-secondary/[0.06] p-5">
              <p className="text-sm text-ink-muted">
                Alimentação, água e sono que o paciente registrou pelo Telegram (fotos do prato,{' '}
                <code className="font-mono-data">/agua</code>, <code className="font-mono-data">/dormi</code>,{' '}
                <code className="font-mono-data">/acordei</code>) — últimos {WELLNESS_HISTORY_DAYS} dias.
              </p>
              <Link
                href={`/patients/${id}`}
                className="shrink-0 rounded-[10px] border border-ink/15 bg-white px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
              >
                ⚙️ Editar metas
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <MetricCard
                label="Kcal"
                points={nutritionDiary.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.kcal }))}
                target={nutritionGoal?.values.kcal}
                targetLabel={nutritionGoal?.values.kcal !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Proteína"
                unit="g"
                points={nutritionDiary.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.protein }))}
                target={nutritionGoal?.values.protein}
                targetLabel={nutritionGoal?.values.protein !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Carbo"
                unit="g"
                points={nutritionDiary.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.carbs }))}
                target={nutritionGoal?.values.carbs}
                targetLabel={nutritionGoal?.values.carbs !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Gordura"
                unit="g"
                points={nutritionDiary.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.fat }))}
                target={nutritionGoal?.values.fat}
                targetLabel={nutritionGoal?.values.fat !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Água"
                unit="ml"
                points={waterHistory.map((p) => ({ measuredAt: new Date(`${p.day}T12:00:00Z`), value: p.consumedMl }))}
                target={nutritionGoal?.values.waterMl}
                targetLabel={nutritionGoal?.values.waterMl !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Sono"
                unit="h"
                points={sleepSessions.map((s) => ({ measuredAt: s.end, value: s.durationMinutes / 60 }))}
                band={{ min: sleepTarget.minMinutes / 60, max: sleepTarget.maxMinutes / 60 }}
                targetLabel={
                  nutritionGoal?.values.sleepMinHours !== undefined && nutritionGoal?.values.sleepMaxHours !== undefined
                    ? `${doctorLabel} · ${nutritionGoal.values.sleepMinHours}–${nutritionGoal.values.sleepMaxHours} h`
                    : 'Faixa de referência · 6–9h30 (padrão)'
                }
              />
            </div>

            {!hasAnyWellnessData ? (
              <p className="text-sm text-ink-muted">
                Ainda não há registros de alimentação, água ou sono. O paciente precisa vincular o
                Telegram (ficha do paciente) e enviar fotos do prato ou usar os comandos{' '}
                <code className="font-mono-data">/agua</code>, <code className="font-mono-data">/dormi</code> e{' '}
                <code className="font-mono-data">/acordei</code>.
              </p>
            ) : (
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  Relatório diário <span className="font-normal text-ink-muted">· bateu a meta?</span>
                </h3>
                <p className="mt-1 text-xs text-ink-muted">
                  ✓ dentro de ~10% da meta · ✗ fora dessa faixa · — sem meta definida ou sem registro
                  nesse dia. Apoio visual, a interpretação é do médico.
                </p>
                <div className="mt-3 overflow-x-auto rounded-[10px] border border-ink/10">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="bg-surface text-ink-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Dia</th>
                        <th className="px-3 py-2 font-medium">Kcal</th>
                        <th className="px-3 py-2 font-medium">Proteína</th>
                        <th className="px-3 py-2 font-medium">Carbo</th>
                        <th className="px-3 py-2 font-medium">Gordura</th>
                        <th className="px-3 py-2 font-medium">Água</th>
                        <th className="px-3 py-2 font-medium">Sono</th>
                        <th className="px-3 py-2 font-medium">Refeições</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReport.map((row) => {
                        const hasFood = (row.diary?.entries.length ?? 0) > 0;
                        const c = row.diary?.progress.consumed;
                        const g = row.diary?.progress.goal;
                        const hasWater = (row.water?.consumedMl ?? 0) > 0;
                        return (
                          <tr key={row.day} className="border-t border-ink/10 text-ink">
                            <td className="px-3 py-2 whitespace-nowrap">
                              {new Date(`${row.day}T12:00:00Z`).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                              })}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {hasFood ? Math.round(c!.kcal) : '—'}{' '}
                              <GoalHitBadge status={classifyDailyStatus(hasFood, c?.kcal ?? 0, g?.kcal)} />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {hasFood ? `${Math.round(c!.protein)}g` : '—'}{' '}
                              <GoalHitBadge status={classifyDailyStatus(hasFood, c?.protein ?? 0, g?.protein)} />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {hasFood ? `${Math.round(c!.carbs)}g` : '—'}{' '}
                              <GoalHitBadge status={classifyDailyStatus(hasFood, c?.carbs ?? 0, g?.carbs)} />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {hasFood ? `${Math.round(c!.fat)}g` : '—'}{' '}
                              <GoalHitBadge status={classifyDailyStatus(hasFood, c?.fat ?? 0, g?.fat)} />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {hasWater ? `${row.water!.consumedMl}ml` : '—'}{' '}
                              <GoalHitBadge status={classifyDailyStatus(hasWater, row.water?.consumedMl ?? 0, row.water?.goalMl)} />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {row.sleep ? (
                                <>
                                  {(row.sleep.durationMinutes / 60).toFixed(1)}h{' '}
                                  <GoalHitBadge status={row.sleep.quality === 'boa' ? 'bateu' : 'nao-bateu'} />
                                </>
                              ) : (
                                <GoalHitBadge status="sem-registro" />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {row.diary && row.diary.entries.length > 0 ? (
                                <details>
                                  <summary className="cursor-pointer text-brand">
                                    {row.diary.entries.length} refeição(ões)
                                  </summary>
                                  <ul className="mt-1 space-y-1 text-ink-muted">
                                    {row.diary.entries.map((entry) => (
                                      <li key={entry.id} className="flex flex-wrap items-center gap-x-1.5">
                                        <span>
                                          {entry.eatenAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        {/* Origem: o médico precisa saber se o número veio da visão
                                            (chuta alimento E porção) ou do texto com quantidades. */}
                                        <span title={entry.source === 'telegram-texto' ? 'Digitado pelo paciente (cálculo pela tabela TACO)' : 'Estimado a partir da foto'}>
                                          {entry.source === 'telegram-texto' ? '✍️' : '📷'}
                                        </span>
                                        <span>· {entry.values.itemsLabel ?? 'sem descrição'}</span>
                                        <span>· ~{Math.round(entry.values.kcal)} kcal</span>
                                        {entry.values.portionsEstimated && (
                                          <span className="text-amber-600" title="O paciente não informou a quantidade de algum item — porção assumida">
                                            ~estimada
                                          </span>
                                        )}
                                        {entry.values.unmatchedItems && entry.values.unmatchedItems.length > 0 && (
                                          <span
                                            className="text-amber-600"
                                            title={`Não encontrado na tabela TACO (fora da conta): ${entry.values.unmatchedItems.join(', ')}`}
                                          >
                                            ❓ {entry.values.unmatchedItems.length} item(ns) fora da conta
                                          </span>
                                        )}
                                        {entry.values.confidence === 'low' && (
                                          <span className="text-amber-600" title="Confiança baixa nesta estimativa">
                                            confiança baixa
                                          </span>
                                        )}
                                        <form action={deleteFoodLogAction} className="inline">
                                          <input type="hidden" name="patientId" value={id} />
                                          <input type="hidden" name="entryId" value={entry.id} />
                                          <button
                                            type="submit"
                                            className="text-ink-muted underline hover:text-red-600"
                                            title="Remover este registro (sai das somas; a linha permanece na trilha de auditoria)"
                                          >
                                            remover
                                          </button>
                                        </form>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              ) : (
                                <span className="text-ink-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
