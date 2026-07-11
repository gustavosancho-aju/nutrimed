import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@nutrimed/db';
import { hashPassword } from '@nutrimed/auth';
import { runAdminBootstrap } from './admin-bootstrap';

/**
 * Acesso ao banco no servidor.
 * - Dev/local (sem DATABASE_URL): PGlite file-backed em `.pgdata` — Postgres real
 *   in-process, sem Docker. Permite logar e navegar o shell localmente.
 * - Produção (DATABASE_URL setado): driver `pg` com TLS obrigatório.
 * Aplica migrations e faz seed de um usuário demo na primeira inicialização.
 */

// Singleton resiliente ao HMR do Next (evita múltiplas instâncias em dev).
const globalForDb = globalThis as unknown as { __nutrimedDb?: Promise<SqlExecutor> };

const DEMO_EMAIL = 'demo@nutrimed.test';
const DEMO_PASSWORD = 'nutrimed123';

/**
 * Semeia o usuário demo APENAS fora de produção (conveniência de dev local).
 * Em produção jamais criamos uma credencial conhecida — usuários reais são
 * provisionados por script administrativo (scripts/admin-provision-user.mjs).
 */
async function seedDemoUser(db: SqlExecutor): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  const res = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM app_user');
  if (Number(res.rows[0]?.count ?? 0) > 0) return;
  await db.query(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3)',
    [DEMO_EMAIL, 'Dra. Demo (Nutróloga)', hashPassword(DEMO_PASSWORD)],
  );
}

async function init(): Promise<SqlExecutor> {
  const databaseUrl = process.env.DATABASE_URL;
  let exec: SqlExecutor;
  if (databaseUrl) {
    const { createPool, pgExecutor } = await import('@nutrimed/db');
    exec = pgExecutor(createPool());
  } else {
    exec = pgliteExecutor(new PGlite('./.pgdata'));
  }
  await runMigrations(exec);
  await seedDemoUser(exec);
  await runAdminBootstrap(); // no-op sem ADMIN_BOOTSTRAP (provisionamento único)
  return exec;
}

export function getDb(): Promise<SqlExecutor> {
  if (!globalForDb.__nutrimedDb) {
    globalForDb.__nutrimedDb = init();
  }
  return globalForDb.__nutrimedDb;
}
