import { describe, it, expect } from 'vitest';
import {
  computeTrend,
  classifyExam,
  parseDecimal,
  EXAM_STATUS_LABEL,
  deriveHeightMeters,
  idealWeightRange,
  idealWeightTarget,
} from './dashboard';

describe('computeTrend (E11/11.6)', () => {
  it('retorna null sem pontos', () => {
    expect(computeTrend([])).toBeNull();
  });

  it('um único ponto: current sem variação', () => {
    const t = computeTrend([{ measuredAt: new Date('2026-01-01'), value: 90 }]);
    expect(t).toEqual({ current: 90, previous: null, delta: null, deltaPct: null });
  });

  it('usa a medição mais recente como current e a anterior como previous (ordena por data)', () => {
    const t = computeTrend([
      { measuredAt: new Date('2026-03-01'), value: 88 },
      { measuredAt: new Date('2026-01-01'), value: 95 },
      { measuredAt: new Date('2026-02-01'), value: 92 },
    ]);
    expect(t!.current).toBe(88);
    expect(t!.previous).toBe(92);
    expect(t!.delta).toBe(-4);
    expect(t!.deltaPct).toBeCloseTo((-4 / 92) * 100, 5);
  });

  it('previous = 0 ⇒ deltaPct null (sem divisão por zero)', () => {
    const t = computeTrend([
      { measuredAt: new Date('2026-01-01'), value: 0 },
      { measuredAt: new Date('2026-02-01'), value: 5 },
    ]);
    expect(t!.delta).toBe(5);
    expect(t!.deltaPct).toBeNull();
  });
});

describe('classifyExam — faixas de referência (E11/11.8 · NFR10)', () => {
  it('LDL: limites ok/atenção/alerta', () => {
    expect(classifyExam('ldl', 99)).toBe('ok');
    expect(classifyExam('ldl', 100)).toBe('atencao');
    expect(classifyExam('ldl', 159)).toBe('atencao');
    expect(classifyExam('ldl', 160)).toBe('alerta');
  });
  it('HbA1C: limites de pré-diabetes/diabetes', () => {
    expect(classifyExam('hba1c', 5.6)).toBe('ok');
    expect(classifyExam('hba1c', 5.7)).toBe('atencao');
    expect(classifyExam('hba1c', 6.4)).toBe('atencao');
    expect(classifyExam('hba1c', 6.5)).toBe('alerta');
  });
  it('Insulina: limites de jejum', () => {
    expect(classifyExam('insulina', 12)).toBe('ok');
    expect(classifyExam('insulina', 12.1)).toBe('atencao');
    expect(classifyExam('insulina', 25)).toBe('atencao');
    expect(classifyExam('insulina', 25.1)).toBe('alerta');
  });
  it('cada status tem rótulo textual (não depende só de cor)', () => {
    expect(EXAM_STATUS_LABEL.ok).toBeTruthy();
    expect(EXAM_STATUS_LABEL.atencao).toBeTruthy();
    expect(EXAM_STATUS_LABEL.alerta).toBeTruthy();
  });
});

describe('parâmetros ideais — altura derivada + peso ideal (OMS)', () => {
  it('deriva altura de peso + IMC (IMC = peso/altura²)', () => {
    // 88.6 kg, IMC 28.6 ⇒ altura ≈ 1.76 m
    expect(deriveHeightMeters(88.6, 28.6)!).toBeCloseTo(1.76, 2);
  });
  it('sem peso ou IMC ⇒ null (não inventa)', () => {
    expect(deriveHeightMeters(undefined, 28.6)).toBeNull();
    expect(deriveHeightMeters(80, undefined)).toBeNull();
    expect(deriveHeightMeters(0, 0)).toBeNull();
  });
  it('faixa de peso ideal = 18,5–24,9 × altura²', () => {
    const r = idealWeightRange(1.76);
    expect(r.min).toBeCloseTo(18.5 * 1.76 * 1.76, 3); // ~57.3
    expect(r.max).toBeCloseTo(24.9 * 1.76 * 1.76, 3); // ~77.1
  });
  it('peso-alvo = IMC 22 × altura²', () => {
    expect(idealWeightTarget(1.76)).toBeCloseTo(22 * 1.76 * 1.76, 3); // ~68.1
  });
});

describe('parseDecimal — entrada manual tolerante', () => {
  it('aceita vírgula e ponto', () => {
    expect(parseDecimal('82,4')).toBe(82.4);
    expect(parseDecimal('82.4')).toBe(82.4);
  });
  it('vazio/invalido ⇒ undefined (campo opcional)', () => {
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('  ')).toBeUndefined();
    expect(parseDecimal('abc')).toBeUndefined();
    expect(parseDecimal(null)).toBeUndefined();
  });
});
