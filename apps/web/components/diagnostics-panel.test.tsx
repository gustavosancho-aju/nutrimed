// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useBoardStore } from '@/lib/board-store';
import { DiagnosticsPanel } from './diagnostics-panel';

const REPORT = {
  active: true,
  sttStatus: 'live',
  finalsCount: 4,
  lastFinalAgoMs: 2000,
  audioSinkRegistered: true,
  boardClients: 1,
  deepgramConfigured: true,
  anthropicConfigured: false,
  persistedFinals: 4,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  useBoardStore.getState().clear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => REPORT }),
  );
});

describe('<DiagnosticsPanel> (A5 — triagem em 30s)', () => {
  it('abre, consulta o servidor e mostra as checagens ✔/✖ em pt-BR', async () => {
    render(<DiagnosticsPanel consultationId="c1" />);
    fireEvent.click(screen.getByText(/diagnóstico do pipeline/i));

    await waitFor(() => {
      expect(screen.getByText(/serviço de voz configurado/i)).toBeDefined();
      expect(screen.getByText(/canal de áudio ativo no servidor/i)).toBeDefined();
      expect(screen.getByText(/falas salvas no servidor: 4/i)).toBeDefined();
      expect(screen.getByText(/último segmento há 2s/i)).toBeDefined();
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/consultations/c1/pipeline-status');
  });

  it('falha de rede no poll → aviso claro, sem crash', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    render(<DiagnosticsPanel consultationId="c1" />);
    fireEvent.click(screen.getByText(/diagnóstico do pipeline/i));

    await waitFor(() => {
      expect(screen.getByText(/não foi possível consultar o servidor/i)).toBeDefined();
    });
  });
});
