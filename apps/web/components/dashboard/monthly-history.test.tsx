// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DailyNutritionDiary } from '@nutrimed/patients';
import { summarizeNutritionMonths } from '@/lib/dashboard';
import { MonthlyHistory } from './monthly-history';

/**
 * Histórico mês a mês (E15 fase 3). O que estes testes protegem é a regra de
 * produto, não o layout: aderência e cobertura precisam aparecer SEPARADAS, com
 * o denominador à vista. Fundir as duas produziria, na apresentação ao paciente,
 * uma porcentagem que o culpa por não ter anotado.
 */

afterEach(cleanup);

/** Dia do diário no formato que a tela consome. */
function day(dayISO: string, kcal: number | null, goalKcal: number | null): DailyNutritionDiary {
  const consumed = { kcal: kcal ?? 0, protein: 0, carbs: 0, fat: 0 };
  return {
    day: dayISO,
    entries: (kcal === null ? [] : [{ id: dayISO }]) as DailyNutritionDiary['entries'],
    progress: {
      day: dayISO,
      consumed,
      goal: goalKcal === null ? null : { kcal: goalKcal, protein: 0, carbs: 0, fat: 0 },
      remaining: null,
    },
  };
}

/** Abril/2026: 30 dias, 12 com registro, 10 batendo a meta. */
function abril(): DailyNutritionDiary[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => day(`2026-04-${String(i + 1).padStart(2, '0')}`, 2000, 2000)),
    ...Array.from({ length: 2 }, (_, i) => day(`2026-04-${String(i + 11).padStart(2, '0')}`, 3200, 2000)),
    ...Array.from({ length: 18 }, (_, i) => day(`2026-04-${String(i + 13).padStart(2, '0')}`, null, 2000)),
  ];
}

function renderAbril() {
  const diary = abril();
  const months = summarizeNutritionMonths(diary);
  return render(
    <MonthlyHistory patientId="p1" months={months} selectedMonth="2026-04" monthDiary={diary} />,
  );
}

describe('<MonthlyHistory>', () => {
  it('mostra aderência e cobertura SEPARADAS, cada uma com seu denominador', () => {
    renderAbril();

    // 10 de 12 dias avaliados = 83% — e não 10/30 = 33%
    expect(screen.getAllByText('83%').length).toBeGreaterThan(0);
    expect(screen.getByText(/Bateu em 10 de 12 dias avaliados/)).toBeTruthy();

    // a lacuna de registro aparece como número próprio, nunca diluída na aderência
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText(/Registrou 12 de 30 dias/)).toBeTruthy();
    expect(screen.queryByText('33%')).toBeNull();
  });

  it('explica em texto que dias sem registro não contam como meta perdida', () => {
    renderAbril();
    expect(screen.getByText(/18 dias sem registro não contam como meta perdida/)).toBeTruthy();
  });

  it('desenha um bloco por dia do mês, com o veredito de cada dia', () => {
    renderAbril();
    const cells = screen.getAllByTestId('day-cell');
    expect(cells).toHaveLength(30);

    const byStatus = (status: string) => cells.filter((c) => c.dataset.status === status).length;
    expect(byStatus('sem-registro')).toBe(18);
    expect(byStatus('bateu')).toBe(10);
    expect(byStatus('nao-bateu')).toBe(2);
  });

  it('mês sem nada avaliável não inventa 0% de aderência', () => {
    const diary = [day('2026-03-01', null, 2000), day('2026-03-02', null, 2000)];
    render(
      <MonthlyHistory
        patientId="p1"
        months={summarizeNutritionMonths(diary)}
        selectedMonth="2026-03"
        monthDiary={diary}
      />,
    );
    expect(screen.getByText(/Nenhum dia avaliável/)).toBeTruthy();
    // sem dado avaliável a ADERÊNCIA fica em branco — nunca vira "0%", que
    // leria como "não bateu nenhuma meta". (Cobertura 0% é correta: não registrou.)
    expect(screen.getByTestId('stat-aderencia').textContent).toContain('—');
    expect(screen.getByTestId('stat-aderencia').textContent).not.toContain('0%');
    expect(screen.getAllByTestId('day-cell').every((c) => c.dataset.status === 'sem-registro')).toBe(true);
  });

  it('navega para os meses vizinhos preservando a aba', () => {
    const diary = [...abril(), day('2026-05-01', 2000, 2000)];
    render(
      <MonthlyHistory
        patientId="p1"
        months={summarizeNutritionMonths(diary)}
        selectedMonth="2026-05"
        monthDiary={diary.filter((d) => d.day.startsWith('2026-05'))}
      />,
    );
    const anterior = screen.getAllByRole('link').find((a) => a.textContent?.includes('◀'));
    expect(anterior?.getAttribute('href')).toBe('/patients/p1/dashboard?aba=bem-estar&mes=2026-04');
  });
});
