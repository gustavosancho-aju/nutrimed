'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  createConsultation,
  grantConsent,
  revokeConsent,
} from '@nutrimed/consent';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';

/** Abre uma nova consulta (com consentimento default NEGADO) e navega para ela. */
export async function startConsultationAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientLabel = String(formData.get('patientLabel') ?? '').trim() || 'Paciente sem rótulo';
  const db = await getDb();
  const consultationId = await createConsultation(db, user.id, patientLabel, getEncryptionKey());
  redirect(`/consultations/${consultationId}`);
}

/** Concede o consentimento de gravação (registra quem/quando). */
export async function grantConsentAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) return;

  const db = await getDb();
  await grantConsent(db, consultationId, user.id);
  revalidatePath(`/consultations/${consultationId}`);
}

/** Revoga o consentimento — interrompe a autorização de captura no servidor. */
export async function revokeConsentAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) return;

  const db = await getDb();
  await revokeConsent(db, consultationId);
  revalidatePath(`/consultations/${consultationId}`);
}
