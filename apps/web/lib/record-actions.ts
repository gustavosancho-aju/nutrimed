'use server';

import { revalidatePath } from 'next/cache';
import { saveConsultationRecord } from '@nutrimed/clinical-notes';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { assertConsultationOwner } from './consultation-owner';

/**
 * Prontuário manual da consulta (Conduta + Anotações do médico) — ciclo 2.
 * Campos VAZIOS são válidos (limpar a conduta é edição legítima); cifrado
 * (NFR9) e auditado 'consultation-record-edit' (NFR10) no pacote.
 */
export async function saveConsultationRecordAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  const db = await getDb();
  await assertConsultationOwner(db, consultationId, user.id);

  const conduct = String(formData.get('conduct') ?? '').trim() || null;
  const annotations = String(formData.get('annotations') ?? '').trim() || null;
  await saveConsultationRecord(db, consultationId, { conduct, annotations }, getEncryptionKey());
  revalidatePath(`/consultations/${consultationId}`);
}
