import { Pool } from 'pg';
import { buildPgConfigFromEnv } from './connection';
import type { SqlExecutor } from './migrate';

/**
 * Executor baseado no driver `pg` para Postgres real (produção).
 * Usa o protocolo de query simples para `exec` (permite múltiplos statements
 * em migrations), e queries parametrizadas (`$1..`) para chamadas com argumentos.
 */
export function pgExecutor(pool: Pool): SqlExecutor {
  return {
    exec: async (sql: string): Promise<void> => {
      await pool.query(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await pool.query(text, params as unknown[]);
      return { rows: result.rows as T[] };
    },
  };
}

/** Cria um Pool `pg` com TLS obrigatório em trânsito (NFR9), a partir do ambiente. */
export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  return new Pool(buildPgConfigFromEnv(env));
}
