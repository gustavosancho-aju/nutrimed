import { randomBytes } from 'node:crypto';
import { hashPassword } from '@nutrimed/auth';

/**
 * Provisionamento administrativo de boot, guardado pela env `ADMIN_BOOTSTRAP`
 * (JSON). TEMPORÁRIO — usado uma única vez para criar o usuário real do médico
 * em produção sem abrir um canal de exec na máquina. Idempotente: se o usuário
 * já existe, não faz nada. Transacional (um único client `pg`).
 *
 * `ADMIN_BOOTSTRAP` (secret, contém só o HASH — nunca a senha em claro):
 *   {"email","displayName","passwordHash","reassignFromEmail?","neutralize?"}
 *
 * Após rodar: `flyctl secrets unset ADMIN_BOOTSTRAP` e remover este módulo.
 */
interface BootstrapConfig {
  email: string;
  displayName?: string;
  passwordHash: string;
  reassignFromEmail?: string;
  neutralize?: boolean;
}

export async function runAdminBootstrap(): Promise<void> {
  const raw = process.env.ADMIN_BOOTSTRAP;
  if (!raw || !process.env.DATABASE_URL) return;

  let cfg: BootstrapConfig;
  try {
    cfg = JSON.parse(raw) as BootstrapConfig;
  } catch {
    console.error('[bootstrap] ADMIN_BOOTSTRAP não é JSON válido — ignorado.');
    return;
  }
  if (!cfg.email || !cfg.passwordHash) {
    console.error('[bootstrap] email/passwordHash ausentes — ignorado.');
    return;
  }

  const { createPool } = await import('@nutrimed/db');
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
      cfg.email,
    ]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`[bootstrap] usuário "${cfg.email}" já existe — nada a fazer.`);
      return;
    }

    const ins = await client.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      [cfg.email, cfg.displayName ?? cfg.email, cfg.passwordHash],
    );
    const userId = ins.rows[0]!.id;
    let summary = `criado "${cfg.email}"`;

    if (cfg.reassignFromEmail) {
      const from = await client.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
        cfg.reassignFromEmail,
      ]);
      if (from.rows.length > 0) {
        const fromId = from.rows[0]!.id;
        const p = await client.query('UPDATE patient SET user_id = $1 WHERE user_id = $2', [userId, fromId]);
        const c = await client.query('UPDATE consultation SET user_id = $1 WHERE user_id = $2', [userId, fromId]);
        await client.query('UPDATE nutrition_goal SET set_by_user_id = $1 WHERE set_by_user_id = $2', [userId, fromId]);
        await client.query('UPDATE body_goal SET set_by_user_id = $1 WHERE set_by_user_id = $2', [userId, fromId]);
        summary += `; reatribuídos ${p.rowCount} paciente(s) e ${c.rowCount} consulta(s) de "${cfg.reassignFromEmail}"`;

        if (cfg.neutralize) {
          await client.query('UPDATE app_user SET password_hash = $1 WHERE id = $2', [
            hashPassword(randomBytes(24).toString('base64')),
            fromId,
          ]);
          const s = await client.query('DELETE FROM session WHERE user_id = $1', [fromId]);
          summary += `; login de origem neutralizado (${s.rowCount} sessão(ões) encerrada(s))`;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`[bootstrap] ✅ ${summary}.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[bootstrap] rollback —', err instanceof Error ? err.message : err);
  } finally {
    client.release();
    await pool.end();
  }
}
