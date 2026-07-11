/**
 * Lógica de apresentação da dashboard de evolução (E11 Fase 3).
 * Funções puras — testáveis sem banco. A classificação de exames é
 * REFERÊNCIA simplificada de apoio visual, NUNCA diagnóstico (NFR10): o
 * médico decide. Sempre acompanhada de rótulo textual (não só cor).
 */

export interface TrendPoint {
  readonly measuredAt: Date;
  readonly value: number;
  /** Desempate p/ medições no mesmo dia (measured_at com hora zerada). */
  readonly createdAt?: Date;
}

/**
 * Ordena pontos por data de medição, desempatando pela ordem de inserção
 * (createdAt) — medições do mesmo dia sairiam em ordem aleatória sem isso.
 * Sem createdAt em ambos retorna 0 (sort estável preserva a ordem de entrada,
 * já cronológica vinda do banco).
 */
export function compareTrendPoints(a: TrendPoint, b: TrendPoint): number {
  const d = a.measuredAt.getTime() - b.measuredAt.getTime();
  if (d !== 0) return d;
  if (a.createdAt && b.createdAt) return a.createdAt.getTime() - b.createdAt.getTime();
  return 0;
}

/** Extrai a série temporal de um campo das medições (ignora os ausentes). */
export function seriesOf<T>(
  rows: readonly { measuredAt: Date; createdAt: Date; values: T }[],
  key: keyof T,
): TrendPoint[] {
  return rows
    .filter((r) => typeof r.values[key] === 'number')
    .map((r) => ({ measuredAt: r.measuredAt, createdAt: r.createdAt, value: r.values[key] as number }));
}

export interface Trend {
  /** Valor da medição mais recente. */
  readonly current: number;
  /** Valor da penúltima medição (null se só há uma). */
  readonly previous: number | null;
  /** current − previous (null se só há uma medição). */
  readonly delta: number | null;
  /** Variação percentual vs. anterior (null se previous é 0/ausente). */
  readonly deltaPct: number | null;
}

/**
 * Tendência de uma série: valor atual + variação vs. a medição anterior.
 * Tolera 0/1 ponto (retorna null / delta null). Ordena por data antes de medir.
 */
export function computeTrend(points: readonly TrendPoint[]): Trend | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort(compareTrendPoints);
  const current = sorted[sorted.length - 1]!.value;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2]!.value : null;
  const delta = previous !== null ? current - previous : null;
  const deltaPct = previous !== null && previous !== 0 ? (delta! / previous) * 100 : null;
  return { current, previous, delta, deltaPct };
}

export type ExamStatus = 'ok' | 'atencao' | 'alerta';
export type ExamMarker = 'ldl' | 'hba1c' | 'insulina';

/** Rótulo textual da faixa (acompanha a cor — acessibilidade/NFR10). */
export const EXAM_STATUS_LABEL: Record<ExamStatus, string> = {
  ok: 'Dentro da referência',
  atencao: 'Atenção',
  alerta: 'Fora da referência',
};

/**
 * Classifica um marcador laboratorial em ok/atenção/alerta por faixas padrão
 * SIMPLIFICADAS (apoio visual, não diagnóstico):
 * - LDL (mg/dL):      ok < 100 · atenção 100–159 · alerta ≥ 160
 * - HbA1C (%):        ok < 5.7 · atenção 5.7–6.4 · alerta ≥ 6.5
 * - Insulina (µU/mL): ok ≤ 12 · atenção 12.1–25 · alerta > 25
 */
export function classifyExam(marker: ExamMarker, value: number): ExamStatus {
  switch (marker) {
    case 'ldl':
      return value < 100 ? 'ok' : value < 160 ? 'atencao' : 'alerta';
    case 'hba1c':
      return value < 5.7 ? 'ok' : value < 6.5 ? 'atencao' : 'alerta';
    case 'insulina':
      return value <= 12 ? 'ok' : value <= 25 ? 'atencao' : 'alerta';
  }
}

// ── Parâmetros ideais (apoio visual) — referência OMS por IMC, NÃO diagnóstico ──

/** Faixa de referência para bandas/metas de um gráfico (min/max no eixo Y). */
export interface TargetBand {
  readonly min: number;
  readonly max: number;
}

/** Faixa de IMC saudável (OMS): 18,5–24,9. Referência de apoio, não diagnóstico. */
export const HEALTHY_IMC: TargetBand = { min: 18.5, max: 24.9 };

/** IMC de referência para o "peso ideal" (ponto médio da faixa saudável). */
export const TARGET_IMC = 22;

/**
 * Deriva a altura (m) de uma medição que tenha peso (kg) e IMC juntos
 * (IMC = peso / altura²). Sem os dois valores ⇒ null. Pura/testável.
 */
export function deriveHeightMeters(peso?: number, imc?: number): number | null {
  if (peso === undefined || imc === undefined || peso <= 0 || imc <= 0) return null;
  return Math.sqrt(peso / imc);
}

/** Faixa de peso saudável (kg) para uma altura (m), pela faixa de IMC da OMS. */
export function idealWeightRange(heightM: number): TargetBand {
  const h2 = heightM * heightM;
  return { min: HEALTHY_IMC.min * h2, max: HEALTHY_IMC.max * h2 };
}

/** Peso-alvo (kg) no IMC de referência ({@link TARGET_IMC}) para a altura (m). */
export function idealWeightTarget(heightM: number): number {
  return TARGET_IMC * heightM * heightM;
}

// ── Distância à meta ("% pra meta") — apoio visual, sem juízo clínico de cor ──

export interface GoalGap {
  /** (atual − meta) / meta × 100. Sinal: + acima da meta, − abaixo. */
  readonly pct: number;
  /** Rótulo pt-BR: "na meta" | "X% acima da meta" | "X% abaixo da meta". */
  readonly label: string;
}

/**
 * Distância percentual do valor atual à meta (com sinal). Semântica estável
 * entre consultas: independe do ponto de partida e da direção clínica desejada
 * (perder gordura vs. ganhar músculo) — o rótulo textual elimina a ambiguidade
 * do sinal. Meta ≤ 0 ou valores não finitos ⇒ null.
 */
export function computeGoalGap(current: number, goal: number): GoalGap | null {
  if (!Number.isFinite(current) || !Number.isFinite(goal) || goal <= 0) return null;
  const pct = ((current - goal) / goal) * 100;
  const label =
    Math.abs(pct) < 0.5
      ? 'na meta'
      : pct > 0
        ? `${pct.toFixed(1)}% acima da meta`
        : `${Math.abs(pct).toFixed(1)}% abaixo da meta`;
  return { pct, label };
}

// ── Classificação de IMC (OMS) — apoio visual de apresentação, NÃO diagnóstico ──

export type ImcTone = 'low' | 'ok' | 'warn' | 'high' | 'severe';

export interface ImcCategory {
  readonly key: string;
  readonly label: string;
  /** Limite inferior (inclusivo) da faixa de IMC. */
  readonly min: number;
  /** Limite superior (exclusivo); null = sem teto (última faixa). */
  readonly max: number | null;
  readonly tone: ImcTone;
}

/** Faixas de IMC da OMS, em ordem. Rótulo textual sempre acompanha a cor. */
export const IMC_CATEGORIES: readonly ImcCategory[] = [
  { key: 'abaixo', label: 'Abaixo do peso', min: 0, max: 18.5, tone: 'low' },
  { key: 'normal', label: 'Peso normal', min: 18.5, max: 25, tone: 'ok' },
  { key: 'pre', label: 'Pré-obesidade', min: 25, max: 30, tone: 'warn' },
  { key: 'ob1', label: 'Obesidade grau I', min: 30, max: 35, tone: 'high' },
  { key: 'ob2', label: 'Obesidade grau II', min: 35, max: 40, tone: 'high' },
  { key: 'ob3', label: 'Obesidade grau III', min: 40, max: null, tone: 'severe' },
];

/** Classifica um IMC na faixa OMS correspondente (apoio visual). */
export function classifyImc(imc: number): ImcCategory {
  for (const cat of IMC_CATEGORIES) {
    if (imc >= cat.min && (cat.max === null || imc < cat.max)) return cat;
  }
  return IMC_CATEGORIES[IMC_CATEGORIES.length - 1]!;
}

/** Aceita "82,4" ou "82.4"; vazio/invalido ⇒ undefined (campo opcional). */
export function parseDecimal(raw: FormDataEntryValue | null): number | undefined {
  if (raw === null) return undefined;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
