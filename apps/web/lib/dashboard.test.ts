import { describe, it, expect } from 'vitest';
import {
  compareTrendPoints,
  computeGoalGap,
  computeTrend,
  classifyExam,
  parseDecimal,
  seriesOf,
  EXAM_STATUS_LABEL,
  deriveHeightMeters,
  idealWeightRange,
  idealWeightTarget,
  imcFromWeight,
  classifyImc,
  IMC_CATEGORIES,
  lastNDaysISO,
  toLocalDayISO,
  classifyGoalHit,
  classifyDailyStatus,
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

  it('pontos no MESMO dia: current = o de createdAt mais recente (bug do gráfico)', () => {
    const day = new Date('2026-05-01T00:00:00Z');
    const t = computeTrend([
      { measuredAt: day, value: 120, createdAt: new Date('2026-05-01T10:00:00Z') },
      { measuredAt: day, value: 100, createdAt: new Date('2026-05-01T09:00:00Z') },
    ]);
    expect(t!.current).toBe(120);
    expect(t!.previous).toBe(100);
    expect(t!.delta).toBe(20); // "vs. anterior" positivo — a reta sobe
  });
});

describe('compareTrendPoints — ordenação com desempate por createdAt', () => {
  it('ordena por measuredAt; desempata por createdAt no mesmo dia', () => {
    const day = new Date('2026-05-01T00:00:00Z');
    const a = { measuredAt: day, value: 100, createdAt: new Date('2026-05-01T09:00:00Z') };
    const b = { measuredAt: day, value: 120, createdAt: new Date('2026-05-01T10:00:00Z') };
    const c = { measuredAt: new Date('2026-04-01T00:00:00Z'), value: 90 };
    expect([b, a, c].sort(compareTrendPoints).map((p) => p.value)).toEqual([90, 100, 120]);
  });
  it('sem createdAt em ambos ⇒ 0 (sort estável preserva a ordem de entrada)', () => {
    const day = new Date('2026-05-01T00:00:00Z');
    expect(
      compareTrendPoints({ measuredAt: day, value: 1 }, { measuredAt: day, value: 2 }),
    ).toBe(0);
  });
});

describe('seriesOf — série temporal a partir das medições', () => {
  it('extrai o campo com createdAt e ignora medições sem o campo', () => {
    const rows = [
      {
        measuredAt: new Date('2026-01-01'),
        createdAt: new Date('2026-01-01T08:00:00Z'),
        values: { ldl: 161 },
      },
      {
        measuredAt: new Date('2026-02-01'),
        createdAt: new Date('2026-02-01T08:00:00Z'),
        values: { hba1c: 5.7 } as { ldl?: number; hba1c?: number },
      },
    ];
    const serie = seriesOf(rows, 'ldl');
    expect(serie).toHaveLength(1);
    expect(serie[0]!.value).toBe(161);
    expect(serie[0]!.createdAt).toEqual(new Date('2026-01-01T08:00:00Z'));
  });
});

describe('computeGoalGap — "% pra meta" (apoio visual)', () => {
  it('acima da meta: sinal + e rótulo "acima"', () => {
    const g = computeGoalGap(87.7, 75);
    expect(g!.pct).toBeCloseTo(16.9, 1);
    expect(g!.label).toBe('16.9% acima da meta');
  });
  it('abaixo da meta: rótulo "abaixo" com valor absoluto', () => {
    const g = computeGoalGap(63, 75);
    expect(g!.pct).toBeCloseTo(-16, 1);
    expect(g!.label).toBe('16.0% abaixo da meta');
  });
  it('a menos de 0,5% da meta ⇒ "na meta"', () => {
    expect(computeGoalGap(75.2, 75)!.label).toBe('na meta');
    expect(computeGoalGap(75, 75)!.label).toBe('na meta');
  });
  it('meta inválida (≤ 0 / não finita) ⇒ null', () => {
    expect(computeGoalGap(80, 0)).toBeNull();
    expect(computeGoalGap(80, -5)).toBeNull();
    expect(computeGoalGap(Number.NaN, 75)).toBeNull();
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
  it('imcFromWeight: inverso da derivação (peso/altura²); inválido ⇒ null', () => {
    expect(imcFromWeight(88.6, 1.76)!).toBeCloseTo(28.6, 1);
    // roundtrip com deriveHeightMeters: altura derivada devolve o IMC original
    const h = deriveHeightMeters(90, 28.8)!;
    expect(imcFromWeight(90, h)!).toBeCloseTo(28.8, 5);
    expect(imcFromWeight(0, 1.76)).toBeNull();
    expect(imcFromWeight(80, 0)).toBeNull();
    expect(imcFromWeight(Number.NaN, 1.76)).toBeNull();
  });
});

describe('classifyImc — faixas OMS (apresentação)', () => {
  it('classifica cada faixa nos limites (min inclusivo, max exclusivo)', () => {
    expect(classifyImc(17).key).toBe('abaixo');
    expect(classifyImc(18.5).key).toBe('normal');
    expect(classifyImc(24.9).key).toBe('normal');
    expect(classifyImc(25).key).toBe('pre');
    expect(classifyImc(28.6).key).toBe('pre'); // o caso do print do usuário
    expect(classifyImc(30).key).toBe('ob1');
    expect(classifyImc(35).key).toBe('ob2');
    expect(classifyImc(40).key).toBe('ob3');
    expect(classifyImc(55).key).toBe('ob3'); // sem teto
  });
  it('faixas são contíguas e ordenadas (sem buraco)', () => {
    for (let i = 1; i < IMC_CATEGORIES.length; i += 1) {
      expect(IMC_CATEGORIES[i]!.min).toBe(IMC_CATEGORIES[i - 1]!.max);
    }
  });
  it('todo rótulo é textual (não depende só de cor)', () => {
    for (const c of IMC_CATEGORIES) expect(c.label.length).toBeGreaterThan(3);
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

describe('lastNDaysISO — janela de dias p/ o gráfico de bem-estar (2026-07-20)', () => {
  it('devolve N dias, do mais antigo ao mais recente (hoje incluso)', () => {
    const dias = lastNDaysISO(new Date('2026-07-15T12:00:00Z'), 5, -180); // BR, meio-dia UTC = 09:00 local
    expect(dias).toEqual(['2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15']);
  });

  it('respeita o fuso: madrugada UTC ainda é o dia anterior no BR', () => {
    // 02:00Z = 23:00 do dia anterior no BR (UTC-3)
    const dias = lastNDaysISO(new Date('2026-07-15T02:00:00Z'), 1, -180);
    expect(dias).toEqual(['2026-07-14']);
  });

  it('days=1 devolve só o dia de hoje', () => {
    expect(lastNDaysISO(new Date('2026-07-15T12:00:00Z'), 1, -180)).toEqual(['2026-07-15']);
  });

  it('toLocalDayISO é a mesma aritmética usada internamente (consistência)', () => {
    expect(toLocalDayISO(new Date('2026-07-15T02:00:00Z'), -180)).toBe('2026-07-14');
    expect(toLocalDayISO(new Date('2026-07-15T12:00:00Z'), -180)).toBe('2026-07-15');
  });
});

describe('classifyGoalHit — relatório diário "bateu/não bateu a meta" (2026-07-20)', () => {
  it('sem meta (null/undefined/zero/negativa) ⇒ sem-meta', () => {
    expect(classifyGoalHit(500, null)).toBe('sem-meta');
    expect(classifyGoalHit(500, undefined)).toBe('sem-meta');
    expect(classifyGoalHit(500, 0)).toBe('sem-meta');
    expect(classifyGoalHit(500, -100)).toBe('sem-meta');
  });

  it('dentro da tolerância padrão (10%) ⇒ bateu, incl. limite exato', () => {
    expect(classifyGoalHit(2000, 2000)).toBe('bateu'); // exato
    expect(classifyGoalHit(2100, 2000)).toBe('bateu'); // +5%
    expect(classifyGoalHit(1900, 2000)).toBe('bateu'); // -5%
    expect(classifyGoalHit(2200, 2000)).toBe('bateu'); // +10% — limite inclusivo
  });

  it('fora da tolerância (acima ou abaixo) ⇒ nao-bateu', () => {
    expect(classifyGoalHit(2201, 2000)).toBe('nao-bateu');
    expect(classifyGoalHit(1799, 2000)).toBe('nao-bateu');
  });

  it('aceita uma tolerância customizada', () => {
    expect(classifyGoalHit(2050, 2000, 5)).toBe('bateu'); // 2.5% ≤ 5%
    expect(classifyGoalHit(2200, 2000, 5)).toBe('nao-bateu'); // 10% > 5%
  });
});

describe('classifyDailyStatus — distingue "sem registro" de "registrou e não bateu" (2026-07-20)', () => {
  it('sem dado (hasData=false) ⇒ sem-registro, mesmo com meta definida', () => {
    expect(classifyDailyStatus(false, 0, 2000)).toBe('sem-registro');
  });

  it('com dado, delega para classifyGoalHit (bateu/não-bateu/sem-meta)', () => {
    expect(classifyDailyStatus(true, 2000, 2000)).toBe('bateu');
    expect(classifyDailyStatus(true, 3000, 2000)).toBe('nao-bateu');
    expect(classifyDailyStatus(true, 2000, null)).toBe('sem-meta');
  });
});
