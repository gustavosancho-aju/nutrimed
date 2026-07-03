import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { getAuditTrail } from '@nutrimed/audit';
import {
  createPairingCode,
  redeemPairingCode,
  resolvePatientByChat,
  isChannelAuthorized,
  revokeChannel,
  getLinkStatus,
} from './link';

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

async function insertUser(exec: SqlExecutor, email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Dra. Demo', 'x'],
  );
  return res.rows[0]!.id;
}

async function insertPatient(exec: SqlExecutor, userId: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
    [userId, 'enc-name'],
  );
  return res.rows[0]!.id;
}

describe('Telegram Link Service — pareamento + gate do canal (E12 — 12.3)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'medico@nutrimed.test');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('createPairingCode — guarda só o hash (ADR-014), audita', () => {
    it('retorna o código em claro mas persiste apenas o hash SHA-256', async () => {
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);

      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      const raw = await exec.query<{ code_hash: string }>(
        'SELECT code_hash FROM telegram_pairing_code WHERE patient_id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.code_hash).not.toBe(code);
      expect(raw.rows[0]!.code_hash).toMatch(/^[a-f0-9]{64}$/);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'telegram-pairing-create')).toBe(true);
    });
  });

  describe('redeemPairingCode — uso único, ativa o canal, audita', () => {
    it('resgate válido vincula o chat, autoriza o gate e audita o consentimento', async () => {
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);

      const result = await redeemPairingCode(exec, 'chat-happy', code);
      expect(result).toEqual({ ok: true, patientId });

      expect(await resolvePatientByChat(exec, 'chat-happy')).toBe(patientId);
      expect(await isChannelAuthorized(exec, 'chat-happy')).toBe(true);
      expect(await getLinkStatus(exec, patientId)).toEqual({
        chatId: 'chat-happy',
        patientId,
        granted: true,
      });

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'telegram-pairing-redeem')).toBe(true);
    });

    it('código inexistente ⇒ invalid', async () => {
      expect(await redeemPairingCode(exec, 'chat-x', 'ZZZZZZZZ')).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('código expirado ⇒ expired (não vincula)', async () => {
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId, { ttlMinutes: -1 });
      expect(await redeemPairingCode(exec, 'chat-exp', code)).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(await isChannelAuthorized(exec, 'chat-exp')).toBe(false);
    });

    it('código já consumido ⇒ consumed no segundo resgate', async () => {
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);
      expect((await redeemPairingCode(exec, 'chat-once', code)).ok).toBe(true);
      expect(await redeemPairingCode(exec, 'chat-once-again', code)).toEqual({
        ok: false,
        reason: 'consumed',
      });
    });
  });

  describe('gate default NEGA + revogação (ADR-013)', () => {
    it('chat não pareado ⇒ gate nega e não resolve paciente', async () => {
      expect(await isChannelAuthorized(exec, 'chat-desconhecido')).toBe(false);
      expect(await resolvePatientByChat(exec, 'chat-desconhecido')).toBeNull();
    });

    it('revogar desliga o canal; reparear (após revogar) reativa — AC7', async () => {
      const patientId = await insertPatient(exec, userId);
      const code1 = await createPairingCode(exec, patientId, userId);
      await redeemPairingCode(exec, 'chat-rev', code1);
      expect(await isChannelAuthorized(exec, 'chat-rev')).toBe(true);

      await revokeChannel(exec, patientId);
      expect(await isChannelAuthorized(exec, 'chat-rev')).toBe(false);
      expect(await resolvePatientByChat(exec, 'chat-rev')).toBeNull();
      expect(await getLinkStatus(exec, patientId)).toBeNull();

      const code2 = await createPairingCode(exec, patientId, userId);
      expect((await redeemPairingCode(exec, 'chat-rev', code2)).ok).toBe(true);
      expect(await isChannelAuthorized(exec, 'chat-rev')).toBe(true);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'telegram-channel-revoke')).toBe(true);
    });

    it('um canal ativo por paciente: parear novo chat revoga o anterior (troca de aparelho)', async () => {
      const patientId = await insertPatient(exec, userId);
      const codeA = await createPairingCode(exec, patientId, userId);
      await redeemPairingCode(exec, 'chat-A', codeA);

      const codeB = await createPairingCode(exec, patientId, userId);
      await redeemPairingCode(exec, 'chat-B', codeB);

      expect(await resolvePatientByChat(exec, 'chat-A')).toBeNull();
      expect(await resolvePatientByChat(exec, 'chat-B')).toBe(patientId);
      expect(await getLinkStatus(exec, patientId)).toEqual({
        chatId: 'chat-B',
        patientId,
        granted: true,
      });
    });
  });
});
