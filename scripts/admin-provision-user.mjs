/**
 * Provisionamento administrativo de um usuário real (fora do seed demo).
 *
 * A senha é hasheada localmente com scrypt no MESMO formato de @nutrimed/auth
 * (`scrypt$<saltB64>$<hashB64>`) — a senha em claro nunca é persistida nem sai
 * desta execução. NADA é hardcoded: tudo vem de variáveis de ambiente.
 *
 * Uso (contra o banco de PRODUÇÃO — Neon):
 *   DATABASE_URL="postgres://..." \
 *   RAFAEL_USER="Rafael.Bastos" \
 *   RAFAEL_PASSWORD="********" \
 *   RAFAEL_NAME="Rafael Bastos" \
 *   REASSIGN_FROM_EMAIL="demo@nutrimed.test" \   # opcional: migra os pacientes do demo
 *   NEUTRALIZE_DEMO="1" \                          # opcional: mata a senha do demo + sessões
 *   node scripts/admin-provision-user.mjs
 *
 * Idempotente: se o usuário já existe, não recria (apenas reporta).
 * Transacional: reatribuição + neutralização acontecem tudo-ou-nada.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const KEY_LENGTH = 64;
function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const {
  DATABASE_URL,
  RAFAEL_USER = 'Rafael.Bastos',
  RAFAEL_PASSWORD,
  RAFAEL_NAME = 'Rafael Bastos',
  REASSIGN_FROM_EMAIL,
  NEUTRALIZE_DEMO,
} = process.env;

if (!DATABASE_URL) throw new Error('DATABASE_URL ausente.');
if (!RAFAEL_PASSWORD) throw new Error('RAFAEL_PASSWORD ausente (senha nunca é hardcoded).');

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Cria o usuário (idempotente).
    const existing = await client.query('SELECT id FROM app_user WHERE email = $1', [RAFAEL_USER]);
    let userId;
    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      console.log(`• Usuário "${RAFAEL_USER}" já existe (${userId}) — não recriado.`);
    } else {
      const ins = await client.query(
        'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
        [RAFAEL_USER, RAFAEL_NAME, hashPassword(RAFAEL_PASSWORD)],
      );
      userId = ins.rows[0].id;
      console.log(`✔ Usuário "${RAFAEL_USER}" criado (${userId}).`);
    }

    // 2) Reatribui os dados de um usuário de origem (ex.: o demo) para o novo.
    if (REASSIGN_FROM_EMAIL) {
      const from = await client.query('SELECT id FROM app_user WHERE email = $1', [
        REASSIGN_FROM_EMAIL,
      ]);
      if (from.rows.length === 0) {
        console.log(`• Origem "${REASSIGN_FROM_EMAIL}" não encontrada — nada a reatribuir.`);
      } else {
        const fromId = from.rows[0].id;
        const p = await client.query('UPDATE patient SET user_id = $1 WHERE user_id = $2', [userId, fromId]);
        const c = await client.query('UPDATE consultation SET user_id = $1 WHERE user_id = $2', [userId, fromId]);
        const ng = await client.query('UPDATE nutrition_goal SET set_by_user_id = $1 WHERE set_by_user_id = $2', [userId, fromId]);
        const bg = await client.query('UPDATE body_goal SET set_by_user_id = $1 WHERE set_by_user_id = $2', [userId, fromId]);
        console.log(
          `✔ Reatribuído de "${REASSIGN_FROM_EMAIL}": ${p.rowCount} paciente(s), ${c.rowCount} consulta(s), ${ng.rowCount} meta(s) nutricional(is), ${bg.rowCount} meta(s) corporal(is).`,
        );

        // 3) Neutraliza o login de origem (senha aleatória + derruba sessões).
        if (NEUTRALIZE_DEMO === '1') {
          await client.query('UPDATE app_user SET password_hash = $1 WHERE id = $2', [
            hashPassword(randomBytes(24).toString('base64')),
            fromId,
          ]);
          const s = await client.query('DELETE FROM session WHERE user_id = $1', [fromId]);
          console.log(
            `✔ Login "${REASSIGN_FROM_EMAIL}" neutralizado (senha aleatória; ${s.rowCount} sessão(ões) encerrada(s)).`,
          );
        }
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Provisionamento concluído.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Rollback —', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
