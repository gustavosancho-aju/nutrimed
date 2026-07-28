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
  loadLabDisplayPrefs,
  MAX_PRESENTED_ANALYTES,
  loadCurrentBodyGoal,
  loadCurrentNutritionGoal,
  listNutritionRange,
  computeAge,
  type DailyNutritionDiary,
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
  lastNMonths,
  monthRangeISO,
  summarizeNutritionMonths,
} from '@/lib/dashboard';
import { buildAnalyteSeries } from '@/lib/lab-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { LabPanelSection } from '@/components/dashboard/lab-panel-section';
import { MeasurementForm } from '@/components/dashboard/measurement-form';
import { MeasurementHistory } from '@/components/dashboard/measurement-history';
import { CustomExamSettings } from '@/components/dashboard/custom-exam-settings';
import { BodyGoalSettings } from '@/components/dashboard/body-goal-settings';
import { GoalHitBadge } from '@/components/dashboard/goal-hit-badge';
import { MonthlyHistory } from '@/components/dashboard/monthly-history';
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
/** Horizonte do plano do paciente — o médico acompanha e apresenta mês a mês. */
const PLAN_MONTHS = 12;

/**
 * Dashboard de evolução do paciente (E11 Fase 3) — 3 abas (Geral · Bioimpedância
 * · Exames) no design premium. Navegação por `?aba=` (server-side). Valida posse.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; erro?: string; editar?: string; mes?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const { aba: abaRaw, erro, editar, mes: mesRaw } = await searchParams;
  const aba: Aba =
    abaRaw === 'bioimpedancia' || abaRaw === 'exames' || abaRaw === 'bem-estar' ? abaRaw : 'geral';

  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const body = await listBodyComposition(db, id, key);
  const labs = await listLabExam(db, id, key);
  const customDefs = await loadCustomExamDefs(db, id, key);
  // Painel laboratorial unificado (E14): campos fixos do E11 + slots
  // personalizados + analitos importados de laudo, tudo em séries por slug.
  const analyteSeries = buildAnalyteSeries(labs, customDefs);
  const labPrefs = await loadLabDisplayPrefs(db, id, key);
  const bodyGoal = await loadCurrentBodyGoal(db, id, key);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const age = computeAge(patient.birthDate, now);

  // Aba Bem-estar: SÓ alimentação (2026-07-28). Água e sono saíram do bot e do
  // painel — o foco do registro do paciente é a alimentação. O schema e os
  // serviços continuam no lugar; religar é re-adicionar as buscas.
  const nutritionGoal = aba === 'bem-estar' ? await loadCurrentNutritionGoal(db, id, key) : null;
  const wellnessDays = lastNDaysISO(now, WELLNESS_HISTORY_DAYS, BR_TZ_OFFSET_MINUTES);
  // Histórico do plano de 12 meses (E15 fase 3). UMA leitura de intervalo cobre
  // tudo: a régua dos 12 meses E o mês selecionado (fatiado em memória). Custo
  // fixo de 2 consultas — o laço dia a dia faria ~730 e travaria a tela.
  const planMonths = lastNMonths(now, PLAN_MONTHS);
  const planStart = monthRangeISO(planMonths[0]!.year, planMonths[0]!.month).start;
  const planEnd = monthRangeISO(
    planMonths[planMonths.length - 1]!.year,
    planMonths[planMonths.length - 1]!.month,
  ).end;
  const planDiary: DailyNutritionDiary[] =
    aba === 'bem-estar' ? await listNutritionRange(db, id, planStart, planEnd, BR_TZ_OFFSET_MINUTES, key) : [];
  const monthlySummaries = summarizeNutritionMonths(planDiary);
  // Mês em exibição: o pedido na URL, se for um dos meses do plano; senão, o atual.
  const currentMonthISO = toLocalDayISO(now, BR_TZ_OFFSET_MINUTES).slice(0, 7);
  const selectedMonth =
    mesRaw && monthlySummaries.some((m) => m.month === mesRaw) ? mesRaw : currentMonthISO;
  const monthDiary = planDiary.filter((d) => d.day.startsWith(selectedMonth));

  // Últimos 14 dias — fatiados do MESMO intervalo já carregado, sem nova ida ao banco.
  const wellnessDaySet = new Set(wellnessDays);
  const nutritionDiary: DailyNutritionDiary[] = planDiary.filter((d) => wellnessDaySet.has(d.day));

  /**
   * Dias COM registro — série dos cartões de métrica.
   *
   * Antes os cartões recebiam todos os 14 dias, e um dia sem registro entrava
   * como ZERO: hoje de manhã, antes do paciente registrar, o cartão mostrava
   * "0 kcal · ▼ -100% · 100% abaixo da meta". Isso é o mesmo erro que o
   * histórico mensal evita — "não registrou" NÃO é "consumiu zero", e exibir
   * isso na frente do paciente é enganoso.
   */
  const diasComRegistro = nutritionDiary.filter((d) => d.entries.length > 0);

  // Relatório diário: uma linha por dia, mais recente primeiro.
  const dailyReport = [...wellnessDays].reverse().map((day, idx) => {
    const i = wellnessDays.length - 1 - idx;
    return { day, diary: nutritionDiary[i] };
  });
  const hasAnyWellnessData = diasComRegistro.length > 0;

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
            {analyteSeries.length === 0 ? (
              <div className="card-premium gold-hairline p-8 text-center">
                <h2 className="font-display text-base font-semibold text-ink">
                  Nenhum exame lançado
                </h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
                  Importe um laudo em PDF para trazer o painel completo de uma vez, ou lance os
                  valores manualmente no formulário abaixo.
                </p>
                <Link
                  href={`/patients/${id}/import`}
                  className="mt-4 inline-block rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Importar laudo
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-4 flex justify-end">
                  <Link
                    href={`/patients/${id}/import`}
                    className="text-sm text-brand transition-opacity hover:opacity-80"
                  >
                    + Importar laudo
                  </Link>
                </div>
                {/* Lista como visão padrão; o médico marca o que vira gráfico. */}
                <LabPanelSection
                  patientId={id}
                  series={analyteSeries}
                  presentedIniciais={labPrefs.presented}
                  max={MAX_PRESENTED_ANALYTES}
                />
              </>
            )}
            <MeasurementForm
              patientId={id}
              kind="lab"
              defaultDate={editingLab ? editingLab.measuredAt.toISOString().slice(0, 10) : today}
              fields={labFields}
              measurementId={editingLab?.id}
              // `panel` (E14) não é campo do formulário — é preservado no
              // servidor pela própria action de edição.
              defaults={editingLab ? { ...editingLab.values, panel: undefined } : undefined}
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
                Alimentação que o paciente registrou pelo Telegram — foto do prato ou{' '}
                <code className="font-mono-data">/comi</code> com as quantidades. Os cartões mostram
                os últimos {WELLNESS_HISTORY_DAYS} dias.
              </p>
              <Link
                href={`/patients/${id}`}
                className="shrink-0 rounded-[10px] border border-ink/15 bg-white px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
              >
                ⚙️ Editar metas
              </Link>
            </div>

            <MonthlyHistory
              patientId={id}
              months={monthlySummaries}
              selectedMonth={selectedMonth}
              monthDiary={monthDiary}
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="Kcal"
                points={diasComRegistro.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.kcal }))}
                target={nutritionGoal?.values.kcal}
                targetLabel={nutritionGoal?.values.kcal !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Proteína"
                unit="g"
                points={diasComRegistro.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.protein }))}
                target={nutritionGoal?.values.protein}
                targetLabel={nutritionGoal?.values.protein !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Carbo"
                unit="g"
                points={diasComRegistro.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.carbs }))}
                target={nutritionGoal?.values.carbs}
                targetLabel={nutritionGoal?.values.carbs !== undefined ? doctorLabel : undefined}
              />
              <MetricCard
                label="Gordura"
                unit="g"
                points={diasComRegistro.map((d) => ({ measuredAt: new Date(`${d.day}T12:00:00Z`), value: d.progress.consumed.fat }))}
                target={nutritionGoal?.values.fat}
                targetLabel={nutritionGoal?.values.fat !== undefined ? doctorLabel : undefined}
              />
            </div>

            {!hasAnyWellnessData ? (
              <p className="text-sm text-ink-muted">
                Ainda não há registros de alimentação, água ou sono. O paciente precisa vincular o
                Telegram (ficha do paciente) e enviar a foto do prato ou usar{' '}
                <code className="font-mono-data">/comi</code> com as quantidades.
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
                        <th className="px-3 py-2 font-medium">Refeições</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReport.map((row) => {
                        const hasFood = (row.diary?.entries.length ?? 0) > 0;
                        const c = row.diary?.progress.consumed;
                        const g = row.diary?.progress.goal;
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
