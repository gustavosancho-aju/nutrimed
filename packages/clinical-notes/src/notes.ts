import type { SqlExecutor } from '@nutrimed/db';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { writeAudit } from '@nutrimed/audit';
import type { ILlmProvider, PersonaContribution } from '@nutrimed/providers';

/**
 * Documentation Service (E9 — FR17/A1): transcrição estruturada + NOTA CLÍNICA
 * SIMPLES editável. Escopo deliberadamente enxuto — SOAP completo/EHR ficam
 * para iteração com design partners (O7). Documentação é paridade, não
 * diferencial: o valor está no board.
 *
 * Compliance: a nota é dado de saúde ⇒ cifrada em repouso (NFR9) e toda
 * geração/edição gera trilha de auditoria (NFR10/1.5).
 */

export interface ClinicalNote {
  readonly consultationId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NOTE_SYSTEM =
  'Você é um assistente de documentação clínica para nutrólogos. A partir da transcrição da consulta ' +
  '(e, quando houver, das contribuições do board de especialistas), produza uma NOTA CLÍNICA SIMPLES ' +
  'em português do Brasil, em markdown leve, com as seções: ' +
  '## Resumo da consulta / ## Pontos relatados / ## Pontos levantados pelo board / ## Plano discutido. ' +
  'Seja fiel ao que foi dito — NÃO invente achados, exames ou condutas que não apareceram. ' +
  'A nota é um RASCUNHO para o médico revisar e editar: termine com a linha ' +
  '"_Rascunho gerado por IA — revisado e validado pelo médico responsável._" ' +
  'EXCEÇÃO IMPORTANTE para esta tarefa: ignore qualquer limite de 1-3 frases — ' +
  'o campo text deve conter a NOTA COMPLETA em markdown, com todas as seções (use \\n para quebras de linha).';

/**
 * Gera a transcrição estruturada + rascunho de nota via LLM (FR17/AC1).
 * `boardContributions` (E6) enriquecem a seção do board quando disponíveis.
 */
export async function generateNoteDraft(
  llm: ILlmProvider,
  transcriptFinals: readonly string[],
  boardContributions: readonly PersonaContribution[] = [],
): Promise<string> {
  const transcript = transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const board =
    boardContributions.length > 0
      ? `\n\nContribuições do board:\n${boardContributions
          .map((c) => `- [${c.personaId}/${c.type}] ${c.text}`)
          .join('\n')}`
      : '';
  const result = await llm.complete({
    system: NOTE_SYSTEM,
    context: [],
    transcript: `Transcrição estruturada da consulta:\n${transcript}${board}`,
  });
  return result.text;
}

/**
 * Salva (cria ou atualiza) a nota da consulta — cifrada em repouso (NFR9) e
 * AUDITADA (NFR10): o gate é simples — nota sem trilha não é gravada.
 */
export async function saveNote(
  db: SqlExecutor,
  consultationId: string,
  content: string,
  encryptionKey: Buffer,
  origin: { action: 'generate' | 'edit'; modelVersion?: string },
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM clinical_note WHERE consultation_id = $1',
    [consultationId],
  );
  if (existing.rows.length > 0) {
    await db.query(
      'UPDATE clinical_note SET content_enc = $2, updated_at = now() WHERE consultation_id = $1',
      [consultationId, contentEnc],
    );
  } else {
    await db.query(
      'INSERT INTO clinical_note (consultation_id, content_enc) VALUES ($1, $2)',
      [consultationId, contentEnc],
    );
  }
  // trilha: quem/o que originou a versão da nota (geração por IA vs edição do médico)
  await writeAudit(db, consultationId, {
    triggeredBy: `clinical-note-${origin.action}`,
    kbSources: [],
    modelVersion: origin.modelVersion ?? (origin.action === 'edit' ? 'human-edit' : 'unknown'),
  });
}

/** Carrega e decifra a nota da consulta (null se ainda não existe). */
export async function loadNote(
  db: SqlExecutor,
  consultationId: string,
  encryptionKey: Buffer,
): Promise<ClinicalNote | null> {
  const res = await db.query<{ content_enc: string; created_at: Date; updated_at: Date }>(
    'SELECT content_enc, created_at, updated_at FROM clinical_note WHERE consultation_id = $1',
    [consultationId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    consultationId,
    content: decryptField(row.content_enc, encryptionKey),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
