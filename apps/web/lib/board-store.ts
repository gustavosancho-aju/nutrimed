import { create } from 'zustand';
import type { BoardServerMessage, WireContribution } from '@nutrimed/shared-types';

/**
 * `useBoardStore` (Story 3.3 — frontend-spec §11.2): fila de contribuições do
 * board. Skeleton: só acumula com dedup por id (AC2/AC4); controles
 * (fixar/dispensar/silenciar/Modo Foco) e decaimento entram no E7 — manter a
 * API pequena para o E7 estender.
 */

export interface BoardContributionItem {
  readonly id: string;
  readonly consultationId: string;
  readonly triggeredBy: string;
  readonly at: number;
  readonly contribution: WireContribution;
}

interface BoardState {
  contributions: BoardContributionItem[];
  /** Adiciona com dedup por id (reconexão pode reenviar — AC4). */
  addContribution(item: BoardContributionItem): void;
  clear(): void;
}

export const useBoardStore = create<BoardState>((set) => ({
  contributions: [],
  addContribution: (item) =>
    set((state) =>
      state.contributions.some((c) => c.id === item.id)
        ? state
        : { contributions: [...state.contributions, item] },
    ),
  clear: () => set({ contributions: [] }),
}));

/** Converte mensagem do fio em item do store (ignora versões/tipos desconhecidos). */
export function toContributionItem(message: BoardServerMessage): BoardContributionItem | null {
  if (message.v !== 1 || message.type !== 'contribution') return null;
  return {
    id: message.id,
    consultationId: message.consultationId,
    triggeredBy: message.triggeredBy,
    at: message.at,
    contribution: message.contribution,
  };
}
