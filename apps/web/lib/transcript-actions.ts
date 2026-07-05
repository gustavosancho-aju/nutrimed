'use server';

import { revalidatePath } from 'next/cache';
import { saveTranscriptReview } from '@nutrimed/clinical-notes';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';

/**
 * Salva a transcrição corrigida pelo médico (Transcrição Confiável). A partir
 * daqui a nota clínica (E9) e o relatório nutricional (E13) nascem da versão
 * revisada. Cifrada + auditada no Documentation Service. Segue o padrão de
 * saveNoteAction (lança em erro — fluxo de baixo risco, form simples).
 */
export async function saveTranscriptReviewAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  const content = String(formData.get('content') ?? '').trim();
  if (!content) throw new Error('Transcrição vazia — não há o que salvar.');
  const db = await getDb();
  await saveTranscriptReview(db, consultationId, content, getEncryptionKey());
  revalidatePath(`/consultations/${consultationId}`);
}
