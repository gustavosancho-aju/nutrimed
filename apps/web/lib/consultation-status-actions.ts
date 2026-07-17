'use server';

import { revalidatePath } from 'next/cache';
import { setConsultationStatus } from '@nutrimed/consent';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { assertConsultationOwner } from './consultation-owner';
import { stopLiveBoard } from './board-runtime';

/**
 * Encerrar/Reabrir consulta (ciclo 2 — registro da consulta). 'closed' liga o
 * modo releitura da página; reversível via Reabrir. Transições auditadas no
 * pacote consent (NFR10).
 */

export async function closeConsultationAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  const db = await getDb();
  await assertConsultationOwner(db, consultationId, user.id);
  // best-effort: derruba a sessão STT/board ativa; falha aqui NUNCA impede encerrar
  try {
    await stopLiveBoard(consultationId);
  } catch (error) {
    console.error('[consulta] stopLiveBoard no encerramento falhou (seguindo):', error);
  }
  await setConsultationStatus(db, consultationId, 'closed');
  revalidatePath(`/consultations/${consultationId}`);
}

export async function reopenConsultationAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  const db = await getDb();
  await assertConsultationOwner(db, consultationId, user.id);
  await setConsultationStatus(db, consultationId, 'open');
  revalidatePath(`/consultations/${consultationId}`);
}
