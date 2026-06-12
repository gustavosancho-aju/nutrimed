// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useBoardStore, feedOrder, type BoardContributionItem } from '@/lib/board-store';
import { SuggestionCard } from './suggestion-card';
import { SuggestionFeed } from './suggestion-feed';

afterEach(cleanup);
beforeEach(() => useBoardStore.getState().clear());

function item(over: Partial<BoardContributionItem> & { id: string }): BoardContributionItem {
  const base = {
    consultationId: 'c1',
    triggeredBy: 't',
    at: 1,
    ...over,
  };
  return {
    ...base,
    contribution: {
      personaId: 'paulo',
      type: 'sugestao',
      severity: 'normal',
      text: 'Vale checar a rotina de sono.',
      ...over.contribution,
    },
  } as BoardContributionItem;
}

describe('E7 — SuggestionCard: 4 tipos + hierarquia de segurança (FR8/NFR4)', () => {
  it('⚠️ atenção: label uppercase, borda de atenção e fundo tingido (não depende só de cor)', () => {
    render(
      <SuggestionCard
        item={item({ id: 'a', contribution: { type: 'atencao', severity: 'critical', text: 'Checar PA.' } as never })}
      />,
    );
    const card = screen.getByRole('article');
    expect(card.getAttribute('data-type')).toBe('atencao');
    expect(screen.getByText('PONTO DE ATENÇÃO')).toBeDefined(); // label textual (daltonismo)
    expect(card.className).toContain('border-l-attn');
    expect(card.className).toContain('bg-attn-bg');
    expect(card.className).toContain('board-pulse'); // pulso 2x (CSS limita; reduced-motion zera)
  });

  it('💡/🔍 têm decaimento de destaque; 📋 síntese é neutra sem decay (NFR3)', () => {
    const { rerender } = render(
      <SuggestionCard item={item({ id: 'b', contribution: { type: 'hipotese' } as never })} />,
    );
    expect(screen.getByRole('article').className).toContain('board-decay');
    expect(screen.getByText('HIPÓTESE')).toBeDefined();

    rerender(<SuggestionCard item={item({ id: 'c', contribution: { type: 'sintese', personaId: 'aurelio' } as never })} />);
    const synth = screen.getByRole('article');
    expect(synth.className).not.toContain('board-decay');
    expect(screen.getByText('SÍNTESE DO BOARD')).toBeDefined();
  });

  it('FR15: fixar marca FIXADO; dispensar registra p/ undo', () => {
    const data = item({ id: 'd' });
    useBoardStore.getState().addContribution(data);
    render(<SuggestionCard item={data} />);

    fireEvent.click(screen.getByLabelText('Fixar'));
    expect(screen.getByText('FIXADO')).toBeDefined();
    expect(useBoardStore.getState().pinned.has('d')).toBe(true);

    fireEvent.click(screen.getByLabelText('Dispensar'));
    expect(useBoardStore.getState().dismissed.has('d')).toBe(true);
    expect(useBoardStore.getState().lastDismissed).toBe('d');
  });

  it('consolidado (FR11) e divergência (FR7) são renderizados', () => {
    render(
      <SuggestionCard
        item={item({ id: 'e', personaIds: ['paulo', 'yara'], divergent: true })}
      />,
    );
    expect(screen.getByText(/Consolidado — Dr\. Paulo \+ Dra\. Yara/)).toBeDefined();
    expect(screen.getByText(/Visões diferentes no board/)).toBeDefined();
  });
});

describe('E7 — feedOrder (FR9): críticos/fixados no topo, resto cronológico inverso', () => {
  it('ordena corretamente e respeita dispensados', () => {
    const items = [
      item({ id: 'old', at: 1 }),
      item({ id: 'crit', at: 2, contribution: { severity: 'critical', type: 'atencao' } as never }),
      item({ id: 'new', at: 3 }),
      item({ id: 'gone', at: 4 }),
    ];
    const { critical, regular } = feedOrder(items, new Set(['old']), new Set(['gone']));
    expect(critical.map((c) => c.id).sort()).toEqual(['crit', 'old']); // ⚠️ + 📌
    expect(regular.map((c) => c.id)).toEqual(['new']); // inverso, sem dispensado
  });
});

describe('E7 — Modo Foco (FR16) e silenciar (FR13) no store', () => {
  it('Modo Foco: não-críticos ficam represados (contador); ⚠️ passam', () => {
    const store = useBoardStore.getState();
    store.toggleFocusMode();
    store.addContribution(item({ id: 'held' }));
    store.addContribution(item({ id: 'crit', contribution: { severity: 'critical', type: 'atencao' } as never }));
    const state = useBoardStore.getState();
    expect(state.heldByFocus).toBe(1);
    expect(state.contributions.map((c) => c.id)).toEqual(['crit']);
  });

  it('doutor silenciado não entra no feed; ⚠️ dele SEMPRE entra (FR13)', () => {
    const store = useBoardStore.getState();
    store.toggleSilence('paulo');
    store.addContribution(item({ id: 'muted' }));
    store.addContribution(item({ id: 'crit', contribution: { severity: 'critical', type: 'atencao' } as never }));
    expect(useBoardStore.getState().contributions.map((c) => c.id)).toEqual(['crit']);
  });
});

describe('E7 — SuggestionFeed: regiões ARIA-live segmentadas + undo (FR15, §9)', () => {
  it('críticos em aria-live=assertive; demais em polite', async () => {
    await act(async () => {
      useBoardStore.getState().addContribution(item({ id: 'n', at: 1 }));
      useBoardStore.getState().addContribution(
        item({ id: 'c', at: 2, contribution: { severity: 'critical', type: 'atencao', text: 'Crítico!' } as never }),
      );
    });
    const { container } = render(<SuggestionFeed />);
    const assertive = container.querySelector('[aria-live="assertive"]')!;
    const polite = container.querySelector('[aria-live="polite"]')!;
    expect(assertive.textContent).toContain('Crítico!');
    expect(polite.textContent).toContain('rotina de sono');
  });

  it('dispensar mostra undo e desfazer restaura (FR15)', async () => {
    await act(async () => {
      useBoardStore.getState().addContribution(item({ id: 'x' }));
    });
    render(<SuggestionFeed />);
    fireEvent.click(screen.getByLabelText('Dispensar'));
    expect(screen.getByText('Desfazer')).toBeDefined();
    fireEvent.click(screen.getByText('Desfazer'));
    expect(useBoardStore.getState().dismissed.has('x')).toBe(false);
    expect(screen.getByText(/rotina de sono/)).toBeDefined();
  });

  it('banner do Modo Foco com contador de represadas', async () => {
    await act(async () => {
      useBoardStore.getState().toggleFocusMode();
      useBoardStore.getState().addContribution(item({ id: 'h1' }));
    });
    render(<SuggestionFeed />);
    expect(screen.getByTestId('focus-banner').textContent).toContain('1 sugestão(ões) aguardando');
  });
});
