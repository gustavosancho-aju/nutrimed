// Persistência do relatório nutricional — espelho de clinical-notes/saveNote:
// cifrado em repouso (NFR9) e AUDITADO (NFR10), com os itens TACO usados na
// trilha (kbSources) — cada valor do relatório aponta sua fonte.
import type { SqlExecutor } from '@nutrimed/db';
import { decryptField, encryptField } from '@nutrimed/crypto';
import { writeAudit } from '@nutrimed/audit';
import type { NutritionComputation } from './compute';

export interface NutritionReport {
  readonly consultationId: string;
  readonly content: string;
  /** Cálculo estruturado da geração (ausente em relatórios só editados/legados). */
  readonly data: NutritionComputation | null;
  readonly tacoVersion: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Salva (cria ou atualiza) o relatório da consulta. `origin.action = 'generate'`
 * regrava também o cálculo estruturado; `'edit'` preserva o cálculo existente
 * (a edição do médico é sobre o TEXTO).
 */
export async function saveNutritionReport(
  db: SqlExecutor,
  consultationId: string,
  content: string,
  encryptionKey: Buffer,
  origin: { action: 'generate' | 'edit'; modelVersion?: string; data?: NutritionComputation },
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  const dataEnc = origin.data ? encryptField(JSON.stringify(origin.data), encryptionKey) : null;
  const tacoVersion = origin.data?.tacoVersion ?? null;

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM nutrition_report WHERE consultation_id = $1',
    [consultationId],
  );
  if (existing.rows.length > 0) {
    if (origin.action === 'generate') {
      await db.query(
        'UPDATE nutrition_report SET content_enc = $2, data_enc = $3, model_version = $4, taco_version = $5, updated_at = now() WHERE consultation_id = $1',
        [consultationId, contentEnc, dataEnc, origin.modelVersion ?? null, tacoVersion],
      );
    } else {
      await db.query(
        'UPDATE nutrition_report SET content_enc = $2, updated_at = now() WHERE consultation_id = $1',
        [consultationId, contentEnc],
      );
    }
  } else {
    await db.query(
      'INSERT INTO nutrition_report (consultation_id, content_enc, data_enc, model_version, taco_version) VALUES ($1, $2, $3, $4, $5)',
      [consultationId, contentEnc, dataEnc, origin.modelVersion ?? null, tacoVersion],
    );
  }

  // Proveniência: os IDs TACO citados vão em kbSources — o médico pode auditar
  // de onde saiu cada número (NFR10).
  const tacoSources =
    origin.data?.items.filter((i) => i.taco).map((i) => `taco:${i.taco!.id}@${origin.data!.tacoVersion}`) ?? [];
  await writeAudit(db, consultationId, {
    triggeredBy: `nutrition-report-${origin.action}`,
    kbSources: tacoSources,
    modelVersion: origin.modelVersion ?? (origin.action === 'edit' ? 'human-edit' : 'unknown'),
  });
}

/** Carrega o relatório decifrado (null se a consulta ainda não tem relatório). */
export async function loadNutritionReport(
  db: SqlExecutor,
  consultationId: string,
  encryptionKey: Buffer,
): Promise<NutritionReport | null> {
  const result = await db.query<{
    content_enc: string;
    data_enc: string | null;
    taco_version: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    'SELECT content_enc, data_enc, taco_version, created_at, updated_at FROM nutrition_report WHERE consultation_id = $1',
    [consultationId],
  );
  const row = result.rows[0];
  if (!row) return null;

  let data: NutritionComputation | null = null;
  if (row.data_enc) {
    try {
      data = JSON.parse(decryptField(row.data_enc, encryptionKey)) as NutritionComputation;
    } catch {
      // dado estruturado corrompido não derruba o texto do relatório
      data = null;
    }
  }
  return {
    consultationId,
    content: decryptField(row.content_enc, encryptionKey),
    data,
    tacoVersion: row.taco_version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
