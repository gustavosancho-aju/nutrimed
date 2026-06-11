// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { BoardServerMessage } from '@nutrimed/shared-types';
import { useBoardStore } from '@/lib/board-store';
import { useBoardStream, type BrowserSocketLike } from '@/lib/use-board-stream';
import { ContributionCard } from './contribution-card';

afterEach(cleanup);
beforeEach(() => useBoardStore.getState().clear());

class FakeBrowserSocket implements BrowserSocketLike {
  static instances: FakeBrowserSocket[] = [];
  listeners = new Map<string, Array<(e: { data?: unknown }) => void>>();
  closed = false;
  constructor(readonly url: string) {
    FakeBrowserSocket.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
  addEventListener(type: string, listener: (e: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(type: string, event: { data?: unknown } = {}): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
  message(payload: BoardServerMessage): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

function contributionMessage(id: string): BoardServerMessage {
  return {
    v: 1,
    type: 'contribution',
    id,
    consultationId: 'c1',
    triggeredBy: 'paulo-seguranca-cv-farmacos',
    at: 1,
    contribution: {
      personaId: 'paulo',
      type: 'atencao',
      severity: 'critical',
      text: 'Vale checar PA e FC antes do GLP-1.',
    },
  };
}

function Feed({ socketFactory }: { socketFactory: (url: string) => BrowserSocketLike }) {
  useBoardStream('c1', { socketFactory, baseUrl: 'ws://test', token: 'tk', retryDelayMs: 1 });
  const contributions = useBoardStore((s) => s.contributions);
  return (
    <div>
      {contributions.map((item) => (
        <ContributionCard key={item.id} item={item} />
      ))}
    </div>
  );
}

describe('Board feed — useBoardStream + useBoardStore + ContributionCard (Story 3.3)', () => {
  beforeEach(() => {
    FakeBrowserSocket.instances = [];
  });

  it('AC1/AC3 — evento do WS vira card no feed com persona, tipo, texto e disclaimer', async () => {
    render(<Feed socketFactory={(url) => new FakeBrowserSocket(url)} />);
    const socket = FakeBrowserSocket.instances[0]!;
    expect(socket.url).toContain('consultationId=c1');
    expect(socket.url).toContain('token=tk');

    await act(async () => socket.message(contributionMessage('evt-1')));

    expect(screen.getByText(/Dr\. Paulo · Cardiologia/)).toBeDefined();
    expect(screen.getByText(/⚠️ Atenção/)).toBeDefined();
    expect(screen.getByText(/Vale checar PA e FC/)).toBeDefined();
    expect(screen.getByText(/Sugestão de apoio\. A conduta é sua\./)).toBeDefined(); // FR19 (1.7)
    expect(screen.getByRole('article').getAttribute('data-severity')).toBe('critical');
  });

  it('mensagens de ping e versões desconhecidas são ignoradas', async () => {
    render(<Feed socketFactory={(url) => new FakeBrowserSocket(url)} />);
    const socket = FakeBrowserSocket.instances[0]!;
    await act(async () => {
      socket.message({ v: 1, type: 'ping', at: 1 });
      socket.emit('message', { data: JSON.stringify({ v: 99, type: 'contribution' }) });
      socket.emit('message', { data: 'não é json' });
    });
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('AC4 — reconecta após close e dedup por id não duplica contribuições', async () => {
    vi.useFakeTimers();
    try {
      render(<Feed socketFactory={(url) => new FakeBrowserSocket(url)} />);
      const first = FakeBrowserSocket.instances[0]!;
      await act(async () => first.message(contributionMessage('evt-1')));

      await act(async () => {
        first.emit('close');
        await vi.advanceTimersByTimeAsync(5);
      });
      expect(FakeBrowserSocket.instances).toHaveLength(2); // reconectou

      const second = FakeBrowserSocket.instances[1]!;
      await act(async () => {
        second.message(contributionMessage('evt-1')); // reenvio pós-reconexão
        second.message(contributionMessage('evt-2'));
      });

      expect(screen.getAllByRole('article')).toHaveLength(2); // sem duplicação
    } finally {
      vi.useRealTimers();
    }
  });

  it('desmonta limpo: fecha o socket e não reconecta', async () => {
    const { unmount } = render(<Feed socketFactory={(url) => new FakeBrowserSocket(url)} />);
    const socket = FakeBrowserSocket.instances[0]!;
    unmount();
    expect(socket.closed).toBe(true);
    await act(async () => socket.emit('close'));
    expect(FakeBrowserSocket.instances).toHaveLength(1);
  });
});
