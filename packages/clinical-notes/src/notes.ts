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
  'Responda APENAS com a nota em markdown, sem preâmbulo nem comentários.';

/**
 * Gera a transcrição estruturada + rascunho de nota via LLM (FR17/AC1).
 * `boardContributions` (E6) enriquecem a seção do board quando disponíveis.
 *
 * Usa `completeText` (texto livre): o contrato JSON de contribuição truncava a
 * nota no maxTokens e derrubava o parse (incidente do piloto, 2026-07-15).
 */
export async function generateNoteDraft(
  llm: ILlmProvider,
  transcriptFinals: readonly string[],
  boardContributions: readonly PersonaContribution[] = [],
): Promise<{ text: string; modelVersion?: string }> {
  if (!llm.completeText) {
    throw new Error(
      'Provider de LLM sem suporte a texto livre (completeText) — necessário para gerar a nota.',
    );
  }
  const transcript = transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const board =
    boardContributions.length > 0
      ? `\n\nContribuições do board:\n${boardContributions
          .map((c) => `- [${c.personaId}/${c.type}] ${c.text}`)
          .join('\n')}`
      : '';
  const result = await llm.completeText({
    system: NOTE_SYSTEM,
    prompt: `Transcrição estruturada da consulta:\n${transcript}${board}`,
    maxTokens: 4000,
  });
  if (!result.text.trim()) {
    // nota VAZIA jamais é gravada como sucesso silencioso (dado clínico)
    throw new Error('O modelo não gerou conteúdo para a nota — tente novamente.');
  }
  return { text: result.text, modelVersion: result.modelVersion };
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

// ── Sínteses do board persistidas (histórico da consulta) ──────────────────

export interface BoardSynthesis {
  readonly id: string;
  readonly consultationId: string;
  readonly content: string;
  readonly modelVersion: string | null;
  readonly createdAt: Date;
}

/**
 * Persiste uma síntese do board (cifrada + auditada) no momento em que é
 * gerada — o histórico da consulta sobrevive a restart. Append-only por design
 * (cada síntese é um registro; nada é sobrescrito).
 */
export async function saveSynthesis(
  db: SqlExecutor,
  consultationId: string,
  content: string,
  encryptionKey: Buffer,
  modelVersion?: string,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    'INSERT INTO board_synthesis (consultation_id, content_enc, model_version) VALUES ($1, $2, $3) RETURNING id',
    [consultationId, encryptField(content, encryptionKey), modelVersion ?? null],
  );
  await writeAudit(db, consultationId, {
    triggeredBy: 'board-synthesis',
    kbSources: [],
    modelVersion: modelVersion ?? 'unknown',
  });
  return res.rows[0]!.id;
}

/** Sínteses salvas da consulta, decifradas, em ordem cronológica. */
export async function listSyntheses(
  db: SqlExecutor,
  consultationId: string,
  encryptionKey: Buffer,
): Promise<BoardSynthesis[]> {
  const res = await db.query<{ id: string; content_enc: string; model_version: string | null; created_at: Date }>(
    `SELECT id, content_enc, model_version, created_at
     FROM board_synthesis WHERE consultation_id = $1
     ORDER BY created_at ASC, id ASC`,
    [consultationId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    consultationId,
    content: decryptField(r.content_enc, encryptionKey),
    modelVersion: r.model_version,
    createdAt: new Date(r.created_at),
  }));
}

// ── Transcript persistido incrementalmente (A4) ────────────────────────────

/**
 * Persiste um segmento FINAL do transcript (cifrado — NFR9). Chamado a cada
 * final da sessão (fire-and-forget no runtime): a nota clínica sobrevive a
 * deploy/restart no meio da consulta. SEM writeAudit por segmento de propósito
 * (inundaria o audit_log — a sessão audita uma única vez em transcript-persist-start);
 * a trilha da NOTA continua em saveNote.
 */
export async function saveTranscriptSegment(
  db: SqlExecutor,
  consultationId: string,
  seq: number,
  text: string,
  encryptionKey: Buffer,
): Promise<void> {
  await db.query(
    `INSERT INTO transcript_segment (consultation_id, seq, content_enc) VALUES ($1, $2, $3)
     ON CONFLICT (consultation_id, seq) DO NOTHING`,
    [consultationId, seq, encryptField(text, encryptionKey)],
  );
}

/** Marca (auditada) o início da persistência de transcript da sessão — 1x por sessão. */
export async function auditTranscriptPersistStart(
  db: SqlExecutor,
  consultationId: string,
): Promise<void> {
  await writeAudit(db, consultationId, {
    triggeredBy: 'transcript-persist-start',
    kbSources: [],
    modelVersion: 'n/a',
  });
}

/** Segmentos finais persistidos da consulta, decifrados, em ordem (seq). */
export async function listTranscriptFinals(
  db: SqlExecutor,
  consultationId: string,
  encryptionKey: Buffer,
): Promise<string[]> {
  const res = await db.query<{ content_enc: string }>(
    'SELECT content_enc FROM transcript_segment WHERE consultation_id = $1 ORDER BY seq ASC',
    [consultationId],
  );
  return res.rows.map((r) => decryptField(r.content_enc, encryptionKey));
}

/**
 * Conta os segmentos finais persistidos SEM decifrar nada — para o painel de
 * diagnóstico (A5), que faz poll a cada 3s e só precisa do número. Evita
 * decifrar N blobs AES-GCM por poll. Também é o dono do schema de
 * `transcript_segment` (o app não faz SQL cru dessa tabela).
 */
export async function countTranscriptFinals(db: SqlExecutor, consultationId: string): Promise<number> {
  const res = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) AS count FROM transcript_segment WHERE consultation_id = $1',
    [consultationId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

// ── Transcrição revisada pelo médico (Transcrição Confiável) ───────────────

export interface TranscriptReview {
  readonly consultationId: string;
  readonly content: string;
  readonly updatedAt: Date;
}

/**
 * Salva a transcrição CORRIGIDA pelo médico (cifrada — NFR9, auditada — NFR10).
 * Os finais crus do STT (transcript_segment) NÃO são tocados: ficam como
 * proveniência do que a máquina ouviu. Esta é a versão que o médico assume como
 * verdadeira e que passa a alimentar os documentos. Uma trilha por save (não por
 * caractere) — 'transcript-reviewed'.
 */
export async function saveTranscriptReview(
  db: SqlExecutor,
  consultationId: string,
  content: string,
  encryptionKey: Buffer,
): Promise<void> {
  const contentEnc = encryptField(content, encryptionKey);
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM transcript_review WHERE consultation_id = $1',
    [consultationId],
  );
  if (existing.rows.length > 0) {
    await db.query(
      'UPDATE transcript_review SET content_enc = $2, updated_at = now() WHERE consultation_id = $1',
      [consultationId, contentEnc],
    );
  } else {
    await db.query(
      'INSERT INTO transcript_review (consultation_id, content_enc) VALUES ($1, $2)',
      [consultationId, contentEnc],
    );
  }
  await writeAudit(db, consultationId, {
    triggeredBy: 'transcript-reviewed',
    kbSources: [],
    modelVersion: 'human-edit',
  });
}

/** Carrega a transcrição revisada (null se o médico ainda não corrigiu). */
export async function loadTranscriptReview(
  db: SqlExecutor,
  consultationId: string,
  encryptionKey: Buffer,
): Promise<TranscriptReview | null> {
  const res = await db.query<{ content_enc: string; updated_at: Date | string }>(
    'SELECT content_enc, updated_at FROM transcript_review WHERE consultation_id = $1',
    [consultationId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    consultationId,
    content: decryptField(row.content_enc, encryptionKey),
    updatedAt: new Date(row.updated_at),
  };
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
