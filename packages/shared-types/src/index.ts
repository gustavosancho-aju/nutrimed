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
