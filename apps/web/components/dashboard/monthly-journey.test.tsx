// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DailyNutritionDiary } from '@nutrimed/patients';
import { summarizeNutritionMonths } from '@/lib/dashboard';
import { MonthlyJourney } from './monthly-journey';

/**
 * Jornada mês a mês no Modo Apresentação (E15 fase 4). Quem lê esta tela é o
 * PACIENTE. Os testes protegem o enquadramento: a mesma verdade do dashboard,
 * dita sem culpar quem não registrou — e sem esconder a lacuna de registro.
 */

afterEach(cleanup);

function day(dayISO: string, kcal: number | null, goalKcal: number | null): DailyNutritionDiary {
  const consumed = { kcal: kcal ?? 0, protein: 0, carbs: 0, fat: 0 };
  return {
    day: dayISO,
    // a tela só usa `entries.length`
    entries: (kcal === null ? [] : [{ id: dayISO }]) as unknown as DailyNutritionDiary['entries'],
    progress: {
      day: dayISO,
      consumed,
      goal: goalKcal === null ? null : { kcal: goalKcal, protein: 0, carbs: 0, fat: 0 },
      remaining: null,
    },
  };
}

/** Abril/2026: 30 dias, 12 registrados, 10 batendo a meta. */
function abril(): DailyNutritionDiary[] {
  return [
    ...Array.from({ length: 10 }, (_, i) => day(`2026-04-${String(i + 1).padStart(2, '0')}`, 2000, 2000)),
    ...Array.from({ length: 2 }, (_, i) => day(`2026-04-${String(i + 11).padStart(2, '0')}`, 3200, 2000)),
    ...Array.from({ length: 18 }, (_, i) => day(`2026-04-${String(i + 13).padStart(2, '0')}`, null, 2000)),
  ];
}

function renderMonth(diary: DailyNutritionDiary[], month = '2026-04') {
  return render(
    <MonthlyJourney
      patientId="p1"
      months={summarizeNutritionMonths(diary)}
      selectedMonth={month}
      monthDiary={diary.filter((d) => d.day.startsWith(month))}
    />,
  );
}

describe('<MonthlyJourney>', () => {
  it('fala com o paciente em frase, com o denominador honesto', () => {
    renderMonth(abril());
    // "10 dias dos 12 que registrou" — o denominador é o que ele registrou,
    // não os 30 do mês
    const frase = screen.getByText(/dos 12 que registrou/);
    expect(frase.textContent).toMatch(/bateu a meta em\s*10 dias\s*dos 12 que registrou/i);
    expect(frase.textContent).not.toMatch(/de 30/); // nunca o mês inteiro como base
  });

  it('mostra a lacuna de registro como fato + razão, nunca como cobrança', () => {
    renderMonth(abril());
    const texto = screen.getByText(/Registrou 12 de 30 dias/).textContent ?? '';
    expect(texto).toMatch(/mais fiel fica o retrato/);
    // sem linguagem de culpa
    expect(texto).not.toMatch(/falhou|perdeu|deixou de|não cumpriu/i);
  });

  it('mês sem registro suficiente não expõe porcentagem ao paciente', () => {
    // abril tem dados (a jornada existe); março, o mês em foco, está vazio
    const diary = [...abril(), day('2026-03-01', null, 2000), day('2026-03-02', null, 2000)];
    renderMonth(diary, '2026-03');
    expect(screen.getByText(/Ainda não há registros suficientes/)).toBeTruthy();
    expect(screen.queryByText(/que registrou/)).toBeNull();
  });

  it('desenha o mês dia a dia com o veredito de cada um', () => {
    renderMonth(abril());
    const cells = screen.getAllByTestId('journey-day');
    expect(cells).toHaveLength(30);
    expect(cells.filter((c) => c.dataset.status === 'bateu')).toHaveLength(10);
    expect(cells.filter((c) => c.dataset.status === 'sem-registro')).toHaveLength(18);
  });

  it('não aparece para paciente sem nenhum registro no plano', () => {
    const vazio = [day('2026-04-01', null, null), day('2026-04-02', null, null)];
    const { container } = renderMonth(vazio);
    expect(container.firstChild).toBeNull();
  });

  it('navega entre meses dentro da própria Apresentação', () => {
    const diary = [...abril(), day('2026-05-01', 2000, 2000)];
    render(
      <MonthlyJourney
        patientId="p1"
        months={summarizeNutritionMonths(diary)}
        selectedMonth="2026-05"
        monthDiary={diary.filter((d) => d.day.startsWith('2026-05'))}
      />,
    );
    const anterior = screen.getAllByRole('link').find((a) => a.textContent?.includes('◀'));
    expect(anterior?.getAttribute('href')).toBe('/patients/p1/apresentacao?mes=2026-04');
  });
});
