// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useBoardStore } from '@/lib/board-store';
import { IdleConsultationBanner } from './idle-consultation-banner';

/**
 * Correção do vazamento de custo (2026-07-24): o estado "consulta ativa e
 * parada" era invisível. O aviso só pode aparecer nessa combinação — durante a
 * conversa normal a sala fica calma (E7).
 */

const ID = 'consulta-1';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  useBoardStore.getState().bindConsultation('outra-consulta'); // força reset
  useBoardStore.getState().bindConsultation(ID);
});

/** Coloca a sessão ao vivo com uma fala recebida `agoMs` atrás. */
function liveWithSpeech(agoMs: number) {
  act(() => {
    useBoardStore.getState().setSttStatus('live');
    useBoardStore.getState().addTranscript('Paciente relata cansaço.', true);
  });
  // envelhece a última fala sem depender de timers reais
  const lastAt = Date.now() - agoMs;
  act(() => {
    useBoardStore.setState((s) => ({ pipeline: { ...s.pipeline, lastTranscriptAt: lastAt } }));
  });
}

describe('<IdleConsultationBanner>', () => {
  it('não aparece durante a conversa (fala recente) — sala calma', () => {
    liveWithSpeech(30_000);
    render(<IdleConsultationBanner />);
    expect(screen.queryByTestId('idle-consultation-banner')).toBeNull();
  });

  it('aparece com a sessão ativa e silêncio prolongado, com os minutos', () => {
    liveWithSpeech(7 * 60_000);
    render(<IdleConsultationBanner />);
    const banner = screen.getByTestId('idle-consultation-banner');
    expect(banner.textContent).toMatch(/sem fala há 7 min/);
    expect(banner.textContent).toMatch(/Encerrar/);
  });

  it('NÃO aparece se a sessão não está rodando (nada a encerrar)', () => {
    liveWithSpeech(30 * 60_000);
    act(() => useBoardStore.getState().setSttStatus('ended'));
    render(<IdleConsultationBanner />);
    expect(screen.queryByTestId('idle-consultation-banner')).toBeNull();
  });

  it('NÃO aparece sem nenhuma fala ainda (mic armado, nada dito ⇒ nada custa)', () => {
    act(() => useBoardStore.getState().setSttStatus('live'));
    render(<IdleConsultationBanner />);
    expect(screen.queryByTestId('idle-consultation-banner')).toBeNull();
  });

  it('passa a aparecer quando o silêncio cruza o limite, sem novos eventos', () => {
    vi.useFakeTimers();
    liveWithSpeech(4 * 60_000); // ainda abaixo do limite de 5 min
    render(<IdleConsultationBanner />);
    expect(screen.queryByTestId('idle-consultation-banner')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2 * 60_000); // o relógio do componente reavalia
    });
    expect(screen.getByTestId('idle-consultation-banner')).toBeTruthy();
  });
});
