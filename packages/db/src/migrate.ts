import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Executor SQL mínimo — abstrai o driver concreto para que as MESMAS migrations
 * rodem em Postgres real (driver `pg`, produção) e em PGlite (in-process, testes
 * sem Docker). É o que torna a criptografia/o schema verificáveis por teste (AC2/AC3).
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Aplica as migrations pendentes em ordem lexicográfica, rastreando as aplicadas
 * em `_migrations`. Idempotente: reexecutar não reaplica nada (AC3).
 * Retorna a lista de migrations efetivamente aplicadas nesta chamada.
 */
export async function runMigrations(db: SqlExecutor): Promise<string[]> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     );`,
  );

  const appliedResult = await db.query<{ name: string }>('SELECT name FROM _migrations');
  const applied = new Set(appliedResult.rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    ran.push(file);
  }
  return ran;
}
