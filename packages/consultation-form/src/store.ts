import type { SqlExecutor } from '@nutrimed/db';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { writeAudit } from '@nutrimed/audit';
import { sanitizeForm, type ConsultationForm } from './schema';

/**
 * Persistência da ficha de consulta. Mesmo contrato da nota clínica: 1 ficha por
 * consulta, cifrada em repouso (NFR9), com trilha de auditoria a cada versão
 * (NFR10) distinguindo o rascunho da IA da revisão do médico.
 *
 * O conteúdo vai como blob JSON dentro de uma coluna cifrada — não como colunas
 * por campo. A ficha é um DOCUMENTO que se lê inteiro e nunca se consulta por
 * pedaço ("todos os pacientes com apneia" é pergunta do dashboard, que tem os
 * dados estruturados do E11/E14); espalhá-la em ~50 colunas cifradas custaria
 * uma migration por campo novo sem habilitar consulta nenhuma.
 */

export interface StoredConsultationForm {
  readonly consultationId: string;
  readonly form: ConsultationForm;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export async function saveConsultationForm(
  db: SqlExecutor,
  consultationId: string,
  form: ConsultationForm,
  encryptionKey: Buffer,
  origin: { action: 'generate' | 'edit'; modelVersion?: string },
): Promise<void> {
  const contentEnc = encryptField(JSON.stringify(form), encryptionKey);
  const modelVersion = origin.modelVersion ?? (origin.action === 'edit' ? 'human-edit' : 'unknown');
  await db.query(
    `INSERT INTO consultation_form (consultation_id, content_enc, model_version)
     VALUES ($1, $2, $3)
     ON CONFLICT (consultation_id)
     DO UPDATE SET content_enc = $2, model_version = $3, updated_at = now()`,
    [consultationId, contentEnc, modelVersion],
  );
  await writeAudit(db, consultationId, {
    triggeredBy: `consultation-form-${origin.action}`,
    kbSources: [],
    modelVersion,
  });
}

/** Carrega a ficha (null se ainda não existe). Blob antigo sempre sai válido. */
export async function loadConsultationForm(
  db: SqlExecutor,
  consultationId: string,
  encryptionKey: Buffer,
): Promise<StoredConsultationForm | null> {
  const res = await db.query<{
    content_enc: string;
    model_version: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `SELECT content_enc, model_version, created_at, updated_at
     FROM consultation_form WHERE consultation_id = $1`,
    [consultationId],
  );
  const row = res.rows[0];
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptField(row.content_enc, encryptionKey));
  } catch {
    parsed = {};
  }
  return {
    consultationId,
    // sanitiza na LEITURA também: uma ficha gravada antes de um campo novo
    // existir precisa continuar abrindo, com o campo novo em branco.
    form: sanitizeForm(parsed),
    modelVersion: row.model_version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
