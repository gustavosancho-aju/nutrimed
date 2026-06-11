/**
 * Tipos compartilhados entre frontend (apps/web) e serviços de domínio (packages/*).
 * Prova de coerência de linguagem e reaproveitamento de tipos do monorepo (ADR-001).
 */

export interface AppInfo {
  readonly name: string;
  readonly version: string;
}

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthReport {
  readonly status: HealthStatus;
  readonly app: AppInfo;
}

// ---------------------------------------------------------------------------
// Protocolo do canal de eventos do board (ADR-003 — Story 3.2)
// Versionado: consumidores devem ignorar mensagens com `v` desconhecido.
// O canal NÃO transporta áudio (architecture §7) — só eventos do board.
// ---------------------------------------------------------------------------

export const BOARD_PROTOCOL_VERSION = 1 as const;

/** Contribuição como trafega no fio (espelho serializável de PersonaContribution). */
export interface WireContribution {
  readonly personaId: 'aurelio' | 'paulo' | 'yara';
  readonly type: 'atencao' | 'sugestao' | 'hipotese' | 'sintese';
  readonly severity: 'normal' | 'critical';
  readonly text: string;
  readonly relevanceScore?: number;
}

export type BoardServerMessage =
  | {
      readonly v: typeof BOARD_PROTOCOL_VERSION;
      readonly type: 'contribution';
      readonly id: string;
      readonly consultationId: string;
      readonly triggeredBy: string;
      readonly at: number;
      readonly contribution: WireContribution;
      /** Personas do card (>1 = consolidado — FR11). Aditivo (E6). */
      readonly personaIds?: readonly string[];
      /** Divergência transparente (FR7). Aditivo (E6). */
      readonly divergent?: boolean;
    }
  | { readonly v: typeof BOARD_PROTOCOL_VERSION; readonly type: 'ping'; readonly at: number };

/** Mensagens cliente→servidor (skeleton: só pong; comandos silenciar/foco são E7). */
export type BoardClientMessage = {
  readonly v: typeof BOARD_PROTOCOL_VERSION;
  readonly type: 'pong';
  readonly at: number;
};
