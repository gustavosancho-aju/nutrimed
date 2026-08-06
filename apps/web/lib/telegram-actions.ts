'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { loadPatient, setNutritionGoal, type NutritionGoalValues } from '@nutrimed/patients';
import { createPairingCode, revokeChannel, setRemindersEnabled } from '@nutrimed/telegram-link';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';
import { parseDecimal } from './dashboard';
import { checkRanges } from './measurement-ranges';

/**
 * Server actions do canal Telegram e das metas (E12/12.4). Toda ação valida a
 * POSSE do paciente (escopo por médico — nunca mexe em paciente de outro médico),
 * reusando os serviços cifrados+auditados de @nutrimed/telegram-link e
 * @nutrimed/patients. O código de pareamento é o registro de consentimento (ADR-013/014).
 */

/** Garante que o paciente pertence ao médico autenticado. */
async function assertOwner(patientId: string) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = await getDb();
  const patient = await loadPatient(db, patientId, getEncryptionKey());
  if (!patient || patient.userId !== user.id) {
    throw new Error('Paciente não encontrado para este médico.');
  }
  return { user, db };
}

/** Gera um código de pareamento (mostrado UMA vez na UI). TTL padrão 15 min. */
export async function generatePairingCodeAction(patientId: string): Promise<string> {
  const { user, db } = await assertOwner(patientId);
  const code = await createPairingCode(db, patientId, user.id);
  revalidatePath(`/patients/${patientId}`);
  return code;
}

/** Revoga o canal Telegram do paciente (idempotente, auditado). */
export async function revokeChannelAction(patientId: string): Promise<void> {
  const { db } = await assertOwner(patientId);
  await revokeChannel(db, patientId);
  revalidatePath(`/patients/${patientId}`);
}

/**
 * Liga/desliga os lembretes proativos deste paciente (E16 Fase 3).
 *
 * É o gate CLÍNICO, e nasce desligado: mensagem proativa é finalidade nova sob a
 * LGPD, e o texto de pareamento que os pacientes atuais aceitaram descrevia um
 * bot que responde — não um que inicia contato. O médico só deve ligar depois de
 * o paciente re-consentir (CJ-14).
 *
 * Não substitui o `/silenciar` do paciente: o titular precisa conseguir se opor
 * sem depender de pedir a alguém (LGPD art. 18).
 */
export async function setRemindersAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { db } = await assertOwner(patientId);
  await setRemindersEnabled(db, patientId, formData.get('enabled') === 'on', 'telegram-reminders-medico');
  revalidatePath(`/patients/${patientId}`);
}

/** Define/atualiza as metas nutricionais (nova versão, cifrada e auditada). */
export async function setGoalAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { user, db } = await assertOwner(patientId);

  // Metas de ÁGUA e SONO saíram (2026-07-28): o bot não coleta mais esses dados
  // e o painel não os mostra — meta sem medição para comparar é ruído na ficha.
  // Os campos seguem OPCIONAIS em NutritionGoalValues e as metas antigas
  // continuam no blob cifrado; só deixaram de ser editáveis.
  const values: NutritionGoalValues = {
    kcal: parseDecimal(formData.get('kcal')) ?? 0,
    protein: parseDecimal(formData.get('protein')) ?? 0,
    carbs: parseDecimal(formData.get('carbs')) ?? 0,
    fat: parseDecimal(formData.get('fat')) ?? 0,
  };
  const rangeError = checkRanges({ ...values });
  if (rangeError) {
    redirect(`/patients/${patientId}?erro=${encodeURIComponent(rangeError)}`);
  }
  const dateRaw = String(formData.get('effectiveFrom') ?? '').trim();
  const effectiveFrom = dateRaw || new Date().toISOString().slice(0, 10);

  await setNutritionGoal(db, patientId, user.id, effectiveFrom, values, getEncryptionKey());
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}
