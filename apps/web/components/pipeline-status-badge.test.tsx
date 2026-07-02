// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useBoardStore } from '@/lib/board-store';
import { PipelineStatusBadge } from './pipeline-status-badge';

afterEach(cleanup);
beforeEach(() => useBoardStore.getState().clear());

describe('<PipelineStatusBadge> (A3 — saúde do pipeline visível)', () => {
  it('tudo bem (live) → nada renderiza (sala calma)', () => {
    useBoardStore.getState().setSttStatus('live');
    const { container } = render(<PipelineStatusBadge />);
    expect(container.textContent).toBe('');
  });

  it('degraded → aviso âmbar de reconexão ao serviço de voz', () => {
    useBoardStore.getState().setSttStatus('degraded');
    render(<PipelineStatusBadge />);
    expect(screen.getByRole('status').textContent).toMatch(/transcrição instável/i);
  });

  it('wsGaveUp → alerta vermelho pedindo recarga (prioridade sobre o resto)', () => {
    useBoardStore.getState().setSttStatus('live');
    useBoardStore.getState().setWsGaveUp();
    render(<PipelineStatusBadge />);
    expect(screen.getByRole('alert').textContent).toMatch(/conexão com o board perdida/i);
  });

  it('ended → indicação discreta de encerramento', () => {
    useBoardStore.getState().setSttStatus('ended');
    render(<PipelineStatusBadge />);
    expect(screen.getByRole('status').textContent).toMatch(/transcrição encerrada/i);
  });
});
