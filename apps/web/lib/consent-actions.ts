'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  createConsultation,
  grantConsent,
  revokeConsent,
} from '@nutrimed/consent';
import { createPatient, loadPatient } from '@nutrimed/patients';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';

/**
 * Abre uma nova consulta (consentimento default NEGADO) vinculada a um paciente
 * (E11/FR23) e navega para ela. Dois caminhos:
 * - `patientId` preenchido ⇒ paciente existente (valida posse pelo médico).
 * - senão ⇒ cadastra um novo paciente a partir de nome/nascimento/telefone.
 * O nome do paciente vira o rótulo cifrado legado (`patient_label_enc`),
 * preservando a coluna NOT NULL sem reintroduzir o "rótulo solto".
 */
export async function startConsultationAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = await getDb();
  const key = getEncryptionKey();

  const existingId = String(formData.get('patientId') ?? '').trim();
  let patientId: string;
  let patientLabel: string;

  if (existingId) {
    // Paciente existente — valida que pertence ao médico logado (sem vazamento).
    const patient = await loadPatient(db, existingId, key);
    if (!patient || patient.userId !== user.id) {
      throw new Error('Paciente não encontrado para este médico.');
    }
    patientId = patient.id;
    patientLabel = patient.name;
  } else {
    // Novo paciente — nome é obrigatório; nascimento/telefone/objetivo opcionais.
    const name = String(formData.get('patientName') ?? '').trim();
    if (!name) throw new Error('Informe o nome do paciente ou selecione um existente.');
    const birthDate = String(formData.get('patientBirthDate') ?? '').trim() || undefined;
    const phone = String(formData.get('patientPhone') ?? '').trim() || undefined;
    const goal = String(formData.get('patientGoal') ?? '').trim() || undefined;
    patientId = await createPatient(db, user.id, { name, birthDate, phone, goal }, key);
    patientLabel = name;
  }

  const consultationId = await createConsultation(db, user.id, patientLabel, key, patientId);
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
