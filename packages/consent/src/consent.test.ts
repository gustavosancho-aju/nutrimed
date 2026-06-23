import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { decryptField } from '@nutrimed/crypto';
import {
  createConsultation,
  grantConsent,
  revokeConsent,
  getConsentStatus,
  isCaptureAuthorized,
  assertCaptureAuthorized,
  listConsultationsByPatient,
  ConsentRequiredError,
} from './consent';

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

const KEY = randomBytes(32);

describe('Consent Service — gate de gravação (FR20)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dr. Aurélio', 'x'],
    );
    userId = res.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  async function openConsultation(): Promise<string> {
    return createConsultation(exec, userId, 'Paciente — sigiloso', KEY);
  }

  describe('AC1/AC6 — sem consentimento, a captura é bloqueada (default nega)', () => {
    it('uma consulta recém-aberta NÃO autoriza captura', async () => {
      const consultationId = await openConsultation();
      expect(await isCaptureAuthorized(exec, consultationId)).toBe(false);
    });

    it('assertCaptureAuthorized lança ConsentRequiredError sem consentimento', async () => {
      const consultationId = await openConsultation();
      await expect(assertCaptureAuthorized(exec, consultationId)).rejects.toBeInstanceOf(
        ConsentRequiredError,
      );
    });

    it('consulta inexistente nunca autoriza captura', async () => {
      expect(await isCaptureAuthorized(exec, '00000000-0000-0000-0000-000000000000')).toBe(false);
    });
  });

  describe('AC2/AC3/AC5 — com consentimento válido, o servidor autoriza', () => {
    it('após grantConsent, o gate de servidor autoriza a captura', async () => {
      const consultationId = await openConsultation();
      await grantConsent(exec, consultationId, userId);
      expect(await isCaptureAuthorized(exec, consultationId)).toBe(true);
      await expect(assertCaptureAuthorized(exec, consultationId)).resolves.toBeUndefined();
    });

    it('registra quem consentiu e quando (auditabilidade)', async () => {
      const consultationId = await openConsultation();
      await grantConsent(exec, consultationId, userId);
      const status = await getConsentStatus(exec, consultationId);
      expect(status?.granted).toBe(true);
      expect(status?.grantedBy).toBe(userId);
      expect(status?.grantedAt).toBeInstanceOf(Date);
    });
  });

  describe('AC4 — revogação interrompe a autorização', () => {
    it('após revokeConsent, o gate volta a negar a captura', async () => {
      const consultationId = await openConsultation();
      await grantConsent(exec, consultationId, userId);
      expect(await isCaptureAuthorized(exec, consultationId)).toBe(true);

      await revokeConsent(exec, consultationId);
      expect(await isCaptureAuthorized(exec, consultationId)).toBe(false);
      await expect(assertCaptureAuthorized(exec, consultationId)).rejects.toBeInstanceOf(
        ConsentRequiredError,
      );
    });
  });

  describe('NFR9 — rótulo do paciente cifrado em repouso', () => {
    it('patient_label_enc não contém o texto em claro e decifra de volta', async () => {
      const label = 'Maria Silva — hipertensão';
      const consultationId = await createConsultation(exec, userId, label, KEY);
      const res = await exec.query<{ patient_label_enc: string }>(
        'SELECT patient_label_enc FROM consultation WHERE id = $1',
        [consultationId],
      );
      const stored = res.rows[0]!.patient_label_enc;
      expect(stored).not.toContain(label);
      expect(decryptField(stored, KEY)).toBe(label);
    });
  });

  describe('FR23 (E11) — vínculo opcional a paciente, sem quebrar o legado', () => {
    it('consulta SEM patientId (legado) continua válida e com patient_id nulo', async () => {
      const consultationId = await openConsultation();
      const res = await exec.query<{ patient_id: string | null }>(
        'SELECT patient_id FROM consultation WHERE id = $1',
        [consultationId],
      );
      expect(res.rows[0]!.patient_id).toBeNull();
      // E o gate de consentimento segue intacto (default nega).
      expect(await isCaptureAuthorized(exec, consultationId)).toBe(false);
    });

    it('consulta COM patientId grava o vínculo', async () => {
      const p = await exec.query<{ id: string }>(
        'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
        [userId, 'x'],
      );
      const patientId = p.rows[0]!.id;
      const consultationId = await createConsultation(exec, userId, 'Paciente X', KEY, patientId);
      const res = await exec.query<{ patient_id: string | null }>(
        'SELECT patient_id FROM consultation WHERE id = $1',
        [consultationId],
      );
      expect(res.rows[0]!.patient_id).toBe(patientId);
    });

    it('listConsultationsByPatient retorna o histórico do paciente, mais recente primeiro (FR24)', async () => {
      const p = await exec.query<{ id: string }>(
        'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
        [userId, 'hist'],
      );
      const patientId = p.rows[0]!.id;
      const c1 = await createConsultation(exec, userId, 'C1', KEY, patientId);
      const c2 = await createConsultation(exec, userId, 'C2', KEY, patientId);
      // paciente sem relação não deve aparecer
      const other = await exec.query<{ id: string }>(
        'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
        [userId, 'outro'],
      );
      const cOutro = await createConsultation(exec, userId, 'C-outro', KEY, other.rows[0]!.id);

      const hist = await listConsultationsByPatient(exec, patientId);
      const ids = hist.map((h) => h.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(c1);
      expect(ids).toContain(c2);
      expect(ids).not.toContain(cOutro); // escopo por paciente
      // ordenação mais-recente-primeiro (sem depender de tie-break por id)
      expect(hist[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(hist[1]!.createdAt.getTime());
      expect(hist[0]!.status).toBe('open');
    });
  });

  describe('Integridade do gate', () => {
    it('grantConsent em consulta inexistente falha (não cria silenciosamente)', async () => {
      await expect(
        grantConsent(exec, '00000000-0000-0000-0000-000000000000', userId),
      ).rejects.toThrow(/não encontrada/);
    });

    it('mantém relação 1:1 — uma única linha de consentimento por consulta', async () => {
      const consultationId = await openConsultation();
      const res = await exec.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM consent WHERE consultation_id = $1',
        [consultationId],
      );
      expect(Number(res.rows[0]?.count)).toBe(1);
    });
  });
});
