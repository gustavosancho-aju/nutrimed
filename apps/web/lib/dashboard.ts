/**
 * Lógica de apresentação da dashboard de evolução (E11 Fase 3).
 * Funções puras — testáveis sem banco. A classificação de exames é
 * REFERÊNCIA simplificada de apoio visual, NUNCA diagnóstico (NFR10): o
 * médico decide. Sempre acompanhada de rótulo textual (não só cor).
 */

export interface TrendPoint {
  readonly measuredAt: Date;
  readonly value: number;
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
  const sorted = [...points].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
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

/** Aceita "82,4" ou "82.4"; vazio/invalido ⇒ undefined (campo opcional). */
export function parseDecimal(raw: FormDataEntryValue | null): number | undefined {
  if (raw === null) return undefined;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
