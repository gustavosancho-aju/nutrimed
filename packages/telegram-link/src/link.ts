import { createHash, randomInt } from 'node:crypto';
import type { SqlExecutor } from '@nutrimed/db';
import { writeAudit } from '@nutrimed/audit';

/**
 * Telegram Link Service (E12 — FR28/FR32) — vínculo `chat_id` → paciente e
 * consentimento do canal como GATE de servidor.
 *
 * Espelha o `@nutrimed/consent`: o servidor é a ÚNICA fonte de verdade sobre se
 * o canal do paciente pode ser processado. Nenhuma foto/mensagem é processada
 * para um `chat_id` que não esteja pareado e consentido — default NEGA (ADR-013).
 *
 * Identidade por CÓDIGO DE PAREAMENTO (ADR-014): o telefone (`phone_enc`) usa IV
 * aleatório e não é buscável, então o vínculo NÃO é por número. O nutricionista
 * gera um código de uso único (só o hash é guardado); o paciente envia
 * `/start CÓDIGO`; o resgate cria o vínculo e É o registro de consentimento.
 */

/** Alfabeto legível (sem 0/O/1/I/L) para códigos fáceis de ditar/digitar. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const DEFAULT_TTL_MINUTES = 15;

export interface PairingCodeOptions {
  /** Validade do código em minutos (default 15). O app passa `PAIRING_CODE_TTL_MIN`. */
  readonly ttlMinutes?: number;
}

export interface ChannelConsent {
  readonly chatId: string;
  readonly patientId: string;
  readonly granted: boolean;
}

/** Resultado do resgate — sucesso com paciente, ou falha com motivo. */
export type RedeemResult =
  | { readonly ok: true; readonly patientId: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'consumed' };

/** Gera um código de pareamento legível e aleatório (uso único). */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Hash determinístico do código (SHA-256, hex). Normaliza caixa/espaços. */
function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * Gera um código de pareamento para o paciente (guarda só o hash — ADR-014),
 * com validade (TTL). Retorna o código EM CLARO — a UI o exibe uma única vez.
 * Auditado (NFR10).
 */
export async function createPairingCode(
  db: SqlExecutor,
  patientId: string,
  createdByUserId: string,
  opts: PairingCodeOptions = {},
): Promise<string> {
  const ttl = opts.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const code = generateCode();
  await db.query(
    `INSERT INTO telegram_pairing_code (patient_id, created_by_user_id, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + $4::interval)`,
    [patientId, createdByUserId, hashCode(code), `${ttl} minutes`],
  );
  await writeAudit(db, patientId, {
    triggeredBy: 'telegram-pairing-create',
    kbSources: [],
    modelVersion: 'human-edit',
  });
  return code;
}

/**
 * Resgata um código para vincular `chatId` ao paciente (uso único). Valida
 * existência/expiração/consumo. Em caso de sucesso: consome o código, revoga
 * qualquer OUTRO canal ativo do paciente (troca de dispositivo), ativa este
 * vínculo (consentido) e audita. O resgate É o registro de consentimento (ADR-013).
 */
export async function redeemPairingCode(
  db: SqlExecutor,
  chatId: string,
  code: string,
): Promise<RedeemResult> {
  const res = await db.query<{
    id: string;
    patient_id: string;
    created_by_user_id: string;
    consumed: boolean;
    expired: boolean;
  }>(
    `SELECT id, patient_id, created_by_user_id,
            (consumed_at IS NOT NULL) AS consumed,
            (expires_at <= now()) AS expired
     FROM telegram_pairing_code
     WHERE code_hash = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [hashCode(code)],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.consumed) return { ok: false, reason: 'consumed' };
  if (row.expired) return { ok: false, reason: 'expired' };

  // Consumo atômico — protege contra corrida de duplo-resgate do mesmo código.
  const consumed = await db.query<{ id: string }>(
    `UPDATE telegram_pairing_code SET consumed_at = now()
     WHERE id = $1 AND consumed_at IS NULL
     RETURNING id`,
    [row.id],
  );
  if (consumed.rows.length === 0) return { ok: false, reason: 'consumed' };

  // Um canal ativo por paciente: revoga os demais (ex.: paciente trocou de aparelho).
  await db.query(
    `UPDATE telegram_link SET revoked_at = now(), updated_at = now()
     WHERE patient_id = $1 AND revoked_at IS NULL AND chat_id <> $2`,
    [row.patient_id, chatId],
  );
  // Ativa (consentido) o vínculo deste chat; reativa se já existia revogado.
  await db.query(
    `INSERT INTO telegram_link (chat_id, patient_id, consent_granted, linked_by_user_id, linked_at)
     VALUES ($1, $2, true, $3, now())
     ON CONFLICT (chat_id) DO UPDATE
       SET patient_id = EXCLUDED.patient_id,
           consent_granted = true,
           linked_by_user_id = EXCLUDED.linked_by_user_id,
           linked_at = now(),
           revoked_at = NULL,
           updated_at = now()`,
    [chatId, row.patient_id, row.created_by_user_id],
  );
  await writeAudit(db, row.patient_id, {
    triggeredBy: 'telegram-pairing-redeem',
    kbSources: [],
    modelVersion: 'human-edit',
  });
  return { ok: true, patientId: row.patient_id };
}

/**
 * Resolve o paciente de um `chatId` — SOMENTE se o vínculo estiver ativo e
 * consentido. Caso contrário null (nunca infere paciente por telefone — ADR-014).
 */
export async function resolvePatientByChat(
  db: SqlExecutor,
  chatId: string,
): Promise<string | null> {
  const res = await db.query<{ patient_id: string }>(
    `SELECT patient_id FROM telegram_link
     WHERE chat_id = $1 AND consent_granted = true AND revoked_at IS NULL`,
    [chatId],
  );
  return res.rows[0]?.patient_id ?? null;
}

/**
 * GATE DE SERVIDOR (espelha `isCaptureAuthorized`) — default NEGA. True apenas
 * se o `chatId` tiver vínculo ativo e consentido. Nunca confia no cliente.
 */
export async function isChannelAuthorized(db: SqlExecutor, chatId: string): Promise<boolean> {
  const res = await db.query<{ ok: boolean }>(
    `SELECT (consent_granted AND revoked_at IS NULL) AS ok
     FROM telegram_link WHERE chat_id = $1`,
    [chatId],
  );
  return res.rows[0]?.ok === true;
}

/**
 * Revoga o canal do paciente (o nutricionista desliga o Telegram). Idempotente;
 * a próxima checagem do gate passa a negar. Auditado.
 */
export async function revokeChannel(db: SqlExecutor, patientId: string): Promise<void> {
  await db.query(
    `UPDATE telegram_link SET revoked_at = now(), updated_at = now()
     WHERE patient_id = $1 AND revoked_at IS NULL`,
    [patientId],
  );
  await writeAudit(db, patientId, {
    triggeredBy: 'telegram-channel-revoke',
    kbSources: [],
    modelVersion: 'human-edit',
  });
}

/**
 * Status do canal ativo do paciente (null se não há canal ativo). Como há no
 * máximo 1 vínculo ativo por paciente (índice único parcial), retorna esse.
 */
export async function getLinkStatus(
  db: SqlExecutor,
  patientId: string,
): Promise<ChannelConsent | null> {
  const res = await db.query<{ chat_id: string; patient_id: string; granted: boolean }>(
    `SELECT chat_id, patient_id, (consent_granted AND revoked_at IS NULL) AS granted
     FROM telegram_link
     WHERE patient_id = $1 AND revoked_at IS NULL
     ORDER BY linked_at DESC NULLS LAST
     LIMIT 1`,
    [patientId],
  );
  const row = res.rows[0];
  return row ? { chatId: row.chat_id, patientId: row.patient_id, granted: row.granted } : null;
}
