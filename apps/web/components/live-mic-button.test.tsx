// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ActionResult } from '@/lib/action-result';
import { LiveMicButton } from './live-mic-button';

/**
 * A1/A2 — o botão da consulta ao vivo: mensagens pt-BR ACIONÁVEIS por código de
 * erro (em produção o Next mascara mensagens de throw em server actions) e
 * ordem mic → formato → servidor (nenhum pipeline órfão no servidor).
 */

const { startLiveBoardAction, stopLiveBoardAction } = vi.hoisted(() => ({
  startLiveBoardAction: vi.fn<(id: string) => Promise<ActionResult>>(),
  stopLiveBoardAction: vi.fn<(id: string) => Promise<ActionResult>>(),
}));

vi.mock('@/lib/board-actions', () => ({ startLiveBoardAction, stopLiveBoardAction }));

/** Mic OK + WebM/Opus suportado (Chrome-like) — cada teste sobrescreve o que precisa. */
function stubBrowserMedia({ mic = 'ok', webmOpus = true }: { mic?: 'ok' | 'denied'; webmOpus?: boolean } = {}) {
  const fakeStream = { getTracks: () => [] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia:
        mic === 'ok'
          ? vi.fn().mockResolvedValue(fakeStream)
          : vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
    },
  });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
    isTypeSupported: (type: string) => webmOpus && type.startsWith('audio/webm'),
  };
}

afterEach(() => {
  cleanup();
  delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
});
beforeEach(() => {
  startLiveBoardAction.mockReset();
  stopLiveBoardAction.mockReset().mockResolvedValue({ ok: true });
  stubBrowserMedia();
});

function renderButton() {
  return render(<LiveMicButton consultationId="c1" token="t1" wsBaseUrl="ws://localhost:0" />);
}

function clickStart() {
  fireEvent.click(screen.getByRole('button', { name: /consulta ao vivo/i }));
}

describe('<LiveMicButton> (A1 — erros tipados das actions)', () => {
  it('consent-required → mensagem cita o consentimento (não erro genérico)', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'consent-required' });
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/consentimento de gravação não registrado/i)).toBeDefined();
    });
  });

  it('stt-missing → mensagem cita o serviço de transcrição', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'stt-missing' });
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/serviço de transcrição não está configurado/i)).toBeDefined();
    });
  });

  it('unauthenticated → pede novo login', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'unauthenticated' });
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/sessão expirada/i)).toBeDefined();
    });
  });

  it('deploy stale (Failed to find Server Action) → aviso + botão de recarregar', async () => {
    startLiveBoardAction.mockRejectedValue(
      new Error('Failed to find Server Action "40f92953". This request might be from an older deployment.'),
    );
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/o sistema foi atualizado enquanto esta página estava aberta/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /recarregar página/i })).toBeDefined();
    });
  });

  it('erro de rede genérico na action → mensagem do erro, sem crash', async () => {
    startLiveBoardAction.mockRejectedValue(new Error('fetch failed'));
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/fetch failed/i)).toBeDefined();
    });
  });
});

describe('<LiveMicButton> (A2 — mic e formato ANTES do servidor)', () => {
  it('mic negado → mensagem clara e o servidor NUNCA é acionado', async () => {
    stubBrowserMedia({ mic: 'denied' });
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/permissão de microfone negada/i)).toBeDefined();
    });
    expect(startLiveBoardAction).not.toHaveBeenCalled();
    expect(stopLiveBoardAction).not.toHaveBeenCalled();
  });

  it('navegador sem WebM/Opus (Safari/iOS) → aviso de navegador incompatível, sem tocar o servidor', async () => {
    stubBrowserMedia({ webmOpus: false });
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(screen.getByText(/não grava áudio em formato compatível/i)).toBeDefined();
    });
    expect(startLiveBoardAction).not.toHaveBeenCalled();
  });

  it('mic ok + formato ok → aciona o servidor', async () => {
    startLiveBoardAction.mockResolvedValue({ ok: false, code: 'internal' }); // para antes do WS
    renderButton();
    clickStart();
    await waitFor(() => {
      expect(startLiveBoardAction).toHaveBeenCalledWith('c1');
    });
  });
});
