import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { runMigrations, type SqlExecutor } from './migrate';

/** Adapta o PGlite (Postgres in-process, WASM) ao SqlExecutor — testes sem Docker. */
function fromPglite(db: PGlite): SqlExecutor {
  return {
    exec: async (sql: string): Promise<void> => {
      await db.exec(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await db.query<T>(text, params as unknown[]);
      return { rows: result.rows };
    },
  };
}

let db: PGlite;
let exec: SqlExecutor;
let firstRun: string[];
const key = randomBytes(32);

async function insertUser(email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name) VALUES ($1, $2) RETURNING id',
    [email, 'Dr. Teste'],
  );
  return res.rows[0]!.id;
}

beforeAll(async () => {
  db = new PGlite();
  exec = fromPglite(db);
  firstRun = await runMigrations(exec);
});

afterAll(async () => {
  await db.close();
});

describe('Migrations 0001 — schema base (AC1, AC3)', () => {
  it('aplica as migrations do zero', () => {
    expect(firstRun).toEqual(['0001_init', '0002_auth_session']);
  });

  it('é idempotente — reexecutar não reaplica nada (AC3)', async () => {
    expect(await runMigrations(exec)).toEqual([]);
  });

  it('cria as 4 entidades base (app_user, consultation, consent, audit_log)', async () => {
    const res = await exec.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['app_user', 'consultation', 'consent', 'audit_log']],
    );
    expect(res.rows.map((r) => r.table_name).sort()).toEqual([
      'app_user',
      'audit_log',
      'consent',
      'consultation',
    ]);
  });
});

describe('Criptografia em repouso — AES-256-GCM (AC2, AC5)', () => {
  it('persiste dado de saúde ILEGÍVEL em claro e recuperável só com a chave', async () => {
    const userId = await insertUser('cripto@nutrimed.test');
    const plaintext = 'Paciente Maria Silva — diabetes tipo 2';
    const encrypted = encryptField(plaintext, key);

    const inserted = await exec.query<{ id: string }>(
      'INSERT INTO consultation (user_id, patient_label_enc) VALUES ($1, $2) RETURNING id',
      [userId, encrypted],
    );
    const consultationId = inserted.rows[0]!.id;

    // Lê o valor BRUTO direto do storage — deve estar cifrado (sem o texto em claro).
    const raw = await exec.query<{ patient_label_enc: string }>(
      'SELECT patient_label_enc FROM consultation WHERE id = $1',
      [consultationId],
    );
    const stored = raw.rows[0]!.patient_label_enc;

    expect(stored).not.toContain('Maria');
    expect(stored).not.toContain('diabetes');
    // E só a chave correta recupera o original.
    expect(decryptField(stored, key)).toBe(plaintext);
  });
});

describe('Integridade dos relacionamentos (AC6)', () => {
  it('USER 1—N CONSULTATION: FK rejeita consultation com user inexistente', async () => {
    const fakeUser = '00000000-0000-0000-0000-000000000000';
    await expect(
      exec.query(
        'INSERT INTO consultation (user_id, patient_label_enc) VALUES ($1, $2)',
        [fakeUser, encryptField('x', key)],
      ),
    ).rejects.toThrow();
  });

  it('CONSULTATION 1—1 CONSENT: UNIQUE rejeita segundo consent na mesma consulta', async () => {
    const userId = await insertUser('consent@nutrimed.test');
    const c = await exec.query<{ id: string }>(
      'INSERT INTO consultation (user_id, patient_label_enc) VALUES ($1, $2) RETURNING id',
      [userId, encryptField('y', key)],
    );
    const consultationId = c.rows[0]!.id;

    await exec.query('INSERT INTO consent (consultation_id, granted) VALUES ($1, $2)', [
      consultationId,
      true,
    ]);
    await expect(
      exec.query('INSERT INTO consent (consultation_id, granted) VALUES ($1, $2)', [
        consultationId,
        false,
      ]),
    ).rejects.toThrow();
  });
});
