import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { runMigrations, type SqlExecutor  } from './migrate';
import { pgliteExecutor } from './testing';

/** Adapta o PGlite (Postgres in-process, WASM) ao SqlExecutor — testes sem Docker. */

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
  exec = pgliteExecutor(db);
  firstRun = await runMigrations(exec);
});

afterAll(async () => {
  await db.close();
});

describe('Migrations 0001 — schema base (AC1, AC3)', () => {
  it('aplica as migrations do zero', () => {
    expect(firstRun).toEqual([
      '0001_init',
      '0002_auth_session',
      '0003_audit_provenance',
      '0004_clinical_note',
      '0005_patients_evolution',
      '0006_telegram_nutrition',
      '0007_board_synthesis',
      '0008_transcript_segment',
    ]);
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

describe('Migration 0005 — pacientes & evolução (Story 11.1)', () => {
  it('cria patient, body_composition e lab_exam', async () => {
    const res = await exec.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['patient', 'body_composition', 'lab_exam']],
    );
    expect(res.rows.map((r) => r.table_name).sort()).toEqual([
      'body_composition',
      'lab_exam',
      'patient',
    ]);
  });

  it('adiciona consultation.patient_id NULLABLE (consultas antigas continuam válidas — AC2)', async () => {
    const col = await exec.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'consultation' AND column_name = 'patient_id'`,
    );
    expect(col.rows[0]!.is_nullable).toBe('YES');

    // Consulta SEM paciente (legado) ainda insere sem erro.
    const userId = await insertUser('legado@nutrimed.test');
    await expect(
      exec.query('INSERT INTO consultation (user_id, patient_label_enc) VALUES ($1, $2)', [
        userId,
        encryptField('Rótulo legado', key),
      ]),
    ).resolves.toBeDefined();
  });

  it('cripto em repouso (AC7): paciente e medição ILEGÍVEIS em claro, recuperáveis só com a chave', async () => {
    const userId = await insertUser('evolucao@nutrimed.test');

    const nameEnc = encryptField('João Pereira', key);
    const p = await exec.query<{ id: string }>(
      'INSERT INTO patient (user_id, name_enc, birth_date_enc) VALUES ($1, $2, $3) RETURNING id',
      [userId, nameEnc, encryptField('1985-04-12', key)],
    );
    const patientId = p.rows[0]!.id;

    const values = JSON.stringify({ peso: 82.4, massaMuscular: 36.1, pgc: 24.3 });
    await exec.query(
      'INSERT INTO body_composition (patient_id, measured_at, values_enc) VALUES ($1, now(), $2)',
      [patientId, encryptField(values, key)],
    );

    const rawPatient = await exec.query<{ name_enc: string }>(
      'SELECT name_enc FROM patient WHERE id = $1',
      [patientId],
    );
    expect(rawPatient.rows[0]!.name_enc).not.toContain('João');
    expect(decryptField(rawPatient.rows[0]!.name_enc, key)).toBe('João Pereira');

    const rawBc = await exec.query<{ values_enc: string }>(
      'SELECT values_enc FROM body_composition WHERE patient_id = $1',
      [patientId],
    );
    expect(rawBc.rows[0]!.values_enc).not.toContain('82.4');
    expect(JSON.parse(decryptField(rawBc.rows[0]!.values_enc, key))).toEqual({
      peso: 82.4,
      massaMuscular: 36.1,
      pgc: 24.3,
    });
  });
});

describe('Migration 0006 — Telegram & nutrição (Story 12.1)', () => {
  it('cria nutrition_goal, food_log_entry, telegram_link e telegram_pairing_code', async () => {
    const res = await exec.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [['nutrition_goal', 'food_log_entry', 'telegram_link', 'telegram_pairing_code']],
    );
    expect(res.rows.map((r) => r.table_name).sort()).toEqual([
      'food_log_entry',
      'nutrition_goal',
      'telegram_link',
      'telegram_pairing_code',
    ]);
  });

  it('índice único parcial garante no máximo 1 canal Telegram ATIVO por paciente', async () => {
    const userId = await insertUser('telegram@nutrimed.test');
    const p = await exec.query<{ id: string }>(
      'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
      [userId, encryptField('Paciente Telegram', key)],
    );
    const patientId = p.rows[0]!.id;

    await exec.query(
      "INSERT INTO telegram_link (chat_id, patient_id, consent_granted, linked_at) VALUES ($1, $2, true, now())",
      ['chat-1', patientId],
    );
    // Segundo vínculo ATIVO para o mesmo paciente é rejeitado pelo índice parcial.
    await expect(
      exec.query(
        "INSERT INTO telegram_link (chat_id, patient_id, consent_granted, linked_at) VALUES ($1, $2, true, now())",
        ['chat-2', patientId],
      ),
    ).rejects.toThrow();

    // Após revogar o primeiro, reparear (novo chat) passa a ser permitido.
    await exec.query("UPDATE telegram_link SET revoked_at = now() WHERE chat_id = 'chat-1'");
    await expect(
      exec.query(
        "INSERT INTO telegram_link (chat_id, patient_id, consent_granted, linked_at) VALUES ($1, $2, true, now())",
        ['chat-2', patientId],
      ),
    ).resolves.toBeDefined();
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
