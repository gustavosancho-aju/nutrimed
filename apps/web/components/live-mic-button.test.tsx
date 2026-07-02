// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
import { LiveMicButton } from './live-mic-button';

/**
 * A1 — o botão da consulta ao vivo mostra mensagens pt-BR ACIONÁVEIS por código
 * de erro (em produção o Next mascara mensagens de throw em server actions).
 */

const { startLiveBoardAction, stopLiveBoardAction } = vi.hoisted(() => ({
  startLiveBoardAction: vi.fn<(id: string) => Promise<ActionResult>>(),
  stopLiveBoardAction: vi.fn<(id: string) => Promise<ActionResult>>(),
}));

vi.mock('@/lib/board-actions', () => ({ startLiveBoardAction, stopLiveBoardAction }));

afterEach(cleanup);
beforeEach(() => {
  startLiveBoardAction.mockReset();
  stopLiveBoardAction.mockReset().mockResolvedValue({ ok: true });
});

function renderButton() {
  return render(<LiveMicButton consultationId="c1" token="t1" wsBaseUrl="ws://localhost:0" />);
}

describe('<LiveMicButton> (A1 — erros tipados)', () => {
  it('consent-required → mensagem cita o consentimento (não erro genérico)', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'consent-required' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /consulta ao vivo/i }));
    await waitFor(() => {
      expect(screen.getByText(/consentimento de gravação não registrado/i)).toBeDefined();
    });
  });

  it('stt-missing → mensagem cita o serviço de transcrição', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'stt-missing' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /consulta ao vivo/i }));
    await waitFor(() => {
      expect(screen.getByText(/serviço de transcrição não está configurado/i)).toBeDefined();
    });
  });

  it('unauthenticated → pede novo login', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'unauthenticated' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /consulta ao vivo/i }));
    await waitFor(() => {
      expect(screen.getByText(/sessão expirada/i)).toBeDefined();
    });
  });

  it('deploy stale (Failed to find Server Action) → aviso + botão de recarregar', async () => {
    startLiveBoardAction.mockRejectedValue(
      new Error('Failed to find Server Action "40f92953". This request might be from an older deployment.'),
    );
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /consulta ao vivo/i }));
    await waitFor(() => {
      expect(screen.getByText(/o sistema foi atualizado enquanto esta página estava aberta/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /recarregar página/i })).toBeDefined();
    });
  });

  it('erro de rede genérico na action → mensagem do erro, sem crash', async () => {
    startLiveBoardAction.mockRejectedValue(new Error('fetch failed'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /consulta ao vivo/i }));
    await waitFor(() => {
      expect(screen.getByText(/fetch failed/i)).toBeDefined();
    });
  });
});
