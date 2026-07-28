import { describe, it, expect } from 'vitest';
import {
  monthDaysISO,
  monthRangeISO,
  lastNMonths,
  summarizeNutritionMonths,
  adherenceTrendPoints,
} from './dashboard';

/**
 * Histórico mês a mês do plano de 12 meses (2026-07-24). A regra que estes
 * testes protegem: "não bateu a meta" e "não registrou" NUNCA se misturam no
 * mesmo número — diluir os dias sem registro na aderência produziria uma
 * porcentagem falsa e cruel na apresentação ao paciente.
 */

/** Constrói um dia do diário no formato que o resumo consome. */
function day(dayISO: string, kcal: number | null, goalKcal: number | null) {
  return {
    day: dayISO,
    entries: kcal === null ? [] : [{}],
    progress: {
      consumed: { kcal: kcal ?? 0 },
      goal: goalKcal === null ? null : { kcal: goalKcal },
    },
  };
}

describe('monthDaysISO / monthRangeISO / lastNMonths', () => {
  it('enumera o mês inteiro, respeitando o tamanho', () => {
    expect(monthDaysISO(2026, 1)).toHaveLength(31);
    expect(monthDaysISO(2026, 4)).toHaveLength(30);
    expect(monthDaysISO(2026, 2)).toHaveLength(28);
    expect(monthDaysISO(2024, 2)).toHaveLength(29); // bissexto
  });

  it('primeiro e último dia do mês', () => {
    expect(monthRangeISO(2026, 7)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('12 meses terminando no mês de referência, atravessando o ano', () => {
    const months = lastNMonths(new Date('2026-07-24T12:00:00Z'), 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 8 }); // 11 meses atrás
    expect(months[11]).toEqual({ year: 2026, month: 7 }); // o mês atual
  });
});

describe('summarizeNutritionMonths — aderência vs. cobertura', () => {
  it('aderência usa como denominador os dias AVALIÁVEIS, não o mês inteiro', () => {
    // 30 dias de mês; registrou 12; bateu 10 desses 12.
    const diary = [
      ...Array.from({ length: 10 }, (_, i) => day(`2026-04-${String(i + 1).padStart(2, '0')}`, 2000, 2000)),
      ...Array.from({ length: 2 }, (_, i) => day(`2026-04-${String(i + 11).padStart(2, '0')}`, 3000, 2000)),
      ...Array.from({ length: 18 }, (_, i) => day(`2026-04-${String(i + 13).padStart(2, '0')}`, null, 2000)),
    ];

    const [abril] = summarizeNutritionMonths(diary);

    expect(abril!.month).toBe('2026-04');
    expect(abril!.daysWithRecord).toBe(12);
    expect(abril!.evaluatedDays).toBe(12);
    expect(abril!.daysHitGoal).toBe(10);
    // 10/12 = 83% — e NÃO 10/30 = 33%, que puniria o paciente por não anotar
    expect(abril!.adherencePct).toBe(83);
    // a lacuna de registro é reportada à parte
    expect(abril!.coveragePct).toBe(40); // 12 de 30
  });

  it('dia sem registro não vira "zero kcal" na média', () => {
    const diary = [
      day('2026-05-01', 2000, 2000),
      day('2026-05-02', 2200, 2000),
      day('2026-05-03', null, 2000),
    ];
    const [maio] = summarizeNutritionMonths(diary);
    expect(maio!.avgKcal).toBe(2100); // média de 2 dias, não de 3
  });

  it('dia com registro mas SEM meta não entra na aderência', () => {
    const diary = [day('2026-06-01', 1800, null), day('2026-06-02', 2000, 2000)];
    const [junho] = summarizeNutritionMonths(diary);
    expect(junho!.daysWithRecord).toBe(2);
    expect(junho!.evaluatedDays).toBe(1); // só o dia que tinha meta
    expect(junho!.adherencePct).toBe(100);
  });

  it('mês sem nada avaliável: aderência null (não inventa 0%)', () => {
    const diary = [day('2026-03-01', null, 2000), day('2026-03-02', null, 2000)];
    const [marco] = summarizeNutritionMonths(diary);
    expect(marco!.adherencePct).toBeNull();
    expect(marco!.coveragePct).toBe(0);
    expect(marco!.avgKcal).toBeNull();
  });

  it('acompanha a META que mudou no meio do caminho (histórico fiel)', () => {
    // meta subiu de 1800 p/ 2200; o mesmo consumo de 2200 muda de veredito
    const diary = [day('2026-02-01', 2200, 1800), day('2026-02-02', 2200, 2200)];
    const [fev] = summarizeNutritionMonths(diary);
    expect(fev!.daysHitGoal).toBe(1);
    expect(fev!.avgGoalKcal).toBe(2000); // média das metas vigentes (1800, 2200)
  });

  it('separa vários meses em ordem cronológica', () => {
    const diary = [
      day('2026-01-15', 2000, 2000),
      day('2026-02-15', 2000, 2000),
      day('2026-03-15', 3000, 2000),
    ];
    const resumo = summarizeNutritionMonths(diary);
    expect(resumo.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(resumo.map((m) => m.adherencePct)).toEqual([100, 100, 0]);
  });
});

describe('adherenceTrendPoints', () => {
  it('vira série do gráfico, pulando meses sem medição', () => {
    const resumo = summarizeNutritionMonths([
      day('2026-01-15', 2000, 2000),
      day('2026-02-15', null, 2000), // sem registro ⇒ sem ponto
      day('2026-03-15', 3000, 2000),
    ]);
    const points = adherenceTrendPoints(resumo);
    expect(points).toHaveLength(2);
    expect(points[0]!.value).toBe(100);
    expect(points[1]!.value).toBe(0);
    expect(points[0]!.measuredAt.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});
