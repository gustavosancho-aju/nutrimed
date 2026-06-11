// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { SessionSnapshot } from '@nutrimed/session';
import { TranscriptionBanner } from './transcription-banner';
import type { TranscriptSource } from './transcript-panel';

afterEach(cleanup);

function makeSource(status: SessionSnapshot['status']) {
  let snapshot: SessionSnapshot = {
    consultationId: 'c1',
    status,
    finalSegments: [],
    partial: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  const source: TranscriptSource = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    source,
    setStatus(s: SessionSnapshot['status']) {
      snapshot = { ...snapshot, status: s };
      listeners.forEach((l) => l());
    },
  };
}

describe('<TranscriptionBanner> (Story 2.6 — AC1/AC2)', () => {
  it('não aparece com a sessão saudável', () => {
    const { source } = makeSource('live');
    render(<TranscriptionBanner source={source} />);
    expect(screen.queryByTestId('transcription-banner')).toBeNull();
  });

  it('degraded → banner discreto "transcrição instável" (AC1)', () => {
    const { source } = makeSource('degraded');
    render(<TranscriptionBanner source={source} />);
    const banner = screen.getByTestId('transcription-banner');
    expect(banner.textContent).toContain('Transcrição instável');
    expect(banner.textContent).toContain('consulta segue');
    expect(banner.getAttribute('role')).toBe('status');
  });

  it('recuperação remove o banner (AC2)', async () => {
    const { source, setStatus } = makeSource('degraded');
    render(<TranscriptionBanner source={source} />);
    expect(screen.getByTestId('transcription-banner')).toBeDefined();
    await act(async () => setStatus('live'));
    expect(screen.queryByTestId('transcription-banner')).toBeNull();
  });
});
