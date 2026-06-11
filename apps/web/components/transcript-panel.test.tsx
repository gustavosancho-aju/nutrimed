// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { SessionSnapshot } from '@nutrimed/session';
import { TranscriptPanel, type TranscriptSource } from './transcript-panel';

afterEach(cleanup);

/** Fonte de transcrição controlável (espelha o contrato da sessão 2.3). */
function makeSource(initial?: Partial<SessionSnapshot>) {
  let snapshot: SessionSnapshot = {
    consultationId: 'c1',
    status: 'live',
    finalSegments: [],
    partial: null,
    error: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const source: TranscriptSource = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const update = (patch: Partial<SessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };
  return { source, update };
}

describe('<TranscriptPanel> (Story 2.4)', () => {
  describe('AC1 — finais e parcial corrente, visualmente distintos', () => {
    it('renderiza segmentos finais e o parcial em itálico/aria-hidden', () => {
      const { source } = makeSource({
        finalSegments: [
          { text: 'Paciente com cefaleia.', isFinal: true },
          { text: 'Refere tontura.', isFinal: true },
        ],
        partial: { text: 'E também can', isFinal: false },
      });
      render(<TranscriptPanel source={source} />);

      expect(screen.getByText('Paciente com cefaleia.')).toBeDefined();
      expect(screen.getByText('Refere tontura.')).toBeDefined();
      const partial = screen.getByTestId('partial-segment');
      expect(partial.textContent).toBe('E também can');
      expect(partial.getAttribute('aria-hidden')).toBe('true');
      expect(partial.className).toContain('italic');
    });

    it('atualiza ao vivo quando a sessão emite novos segmentos (AC5 — via subscribe)', async () => {
      const { source, update } = makeSource();
      render(<TranscriptPanel source={source} />);
      await act(async () => {
        update({ finalSegments: [{ text: 'Novo segmento final.', isFinal: true }] });
      });
      expect(screen.getByText('Novo segmento final.')).toBeDefined();
    });
  });

  describe('AC3 — estados streaming / pausado / erro-transcrição', () => {
    it('live → streaming', () => {
      const { source } = makeSource({ status: 'live' });
      render(<TranscriptPanel source={source} />);
      expect(screen.getByTestId('panel-state').getAttribute('data-state')).toBe('streaming');
    });

    it('ended → pausado', () => {
      const { source } = makeSource({ status: 'ended' });
      render(<TranscriptPanel source={source} />);
      expect(screen.getByTestId('panel-state').getAttribute('data-state')).toBe('pausado');
    });

    it('degraded → erro-transcricao (integra com banner da 2.6)', () => {
      const { source } = makeSource({ status: 'degraded', error: new Error('stt caiu') });
      render(<TranscriptPanel source={source} />);
      const state = screen.getByTestId('panel-state');
      expect(state.getAttribute('data-state')).toBe('erro-transcricao');
      expect(state.textContent).toContain('instável');
    });
  });

  describe('AC2 — auto-follow pausa ao rolar para cima e retoma pelo affordance', () => {
    function scrollAwayFromBottom(log: HTMLElement) {
      Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true });
      Object.defineProperty(log, 'clientHeight', { value: 200, configurable: true });
      log.scrollTop = 100; // longe do fundo
      fireEvent.scroll(log);
    }

    it('rolar para cima mostra "Voltar ao vivo"; clicar retoma o follow', async () => {
      const { source, update } = makeSource({
        finalSegments: [{ text: 'a', isFinal: true }],
      });
      render(<TranscriptPanel source={source} />);
      const log = screen.getByRole('log');

      expect(screen.queryByText(/Voltar ao vivo/)).toBeNull();
      scrollAwayFromBottom(log);
      const resume = await screen.findByText(/Voltar ao vivo/);

      // com follow pausado, novos segmentos não mexem no scroll do usuário
      await act(async () => {
        update({ finalSegments: [{ text: 'a', isFinal: true }, { text: 'b', isFinal: true }] });
      });
      expect(log.scrollTop).toBe(100);

      fireEvent.click(resume);
      expect(screen.queryByText(/Voltar ao vivo/)).toBeNull();
      expect(log.scrollTop).toBe(1000); // colado na ponta
    });
  });

  describe('AC4 — acessibilidade', () => {
    it('região é um log; apenas os finais ficam em aria-live=polite', () => {
      const { source } = makeSource({
        finalSegments: [{ text: 'final.', isFinal: true }],
        partial: { text: 'parcial', isFinal: false },
      });
      const { container } = render(<TranscriptPanel source={source} />);
      const log = screen.getByRole('log');
      const live = log.querySelector('[aria-live="polite"]');
      expect(live).not.toBeNull();
      expect(live!.textContent).toContain('final.');
      expect(live!.textContent).not.toContain('parcial');
      expect(container.innerHTML).not.toMatch(/animate-/);
    });
  });
});
