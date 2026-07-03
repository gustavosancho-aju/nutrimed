'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  loadPatient,
  addBodyComposition,
  addLabExam,
  type BodyCompositionValues,
  type LabExamValues,
} from '@nutrimed/patients';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';
import { parseDecimal } from './dashboard';

/** Remove chaves undefined — uma medição parcial (só alguns campos) é válida. */
function compact<T extends Record<string, number | undefined>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Entrada manual de medição (E11/11.6) — caminho primário da dashboard
 * (degradação graciosa antes do PDF). Grava cifrado + auditado via
 * @nutrimed/patients (11.2). Valida posse do paciente.
 */
export async function addMeasurementAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const kind = String(formData.get('kind') ?? '');
  const aba = kind === 'lab' ? 'exames' : 'bioimpedancia';

  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, patientId, key);
  if (!patient || patient.userId !== user.id) {
    throw new Error('Paciente não encontrado para este médico.');
  }

  const dateRaw = String(formData.get('measuredAt') ?? '').trim();
  const measuredAt = dateRaw ? new Date(`${dateRaw}T00:00:00Z`) : new Date();

  // Proveniência (NFR10): se veio de importação, a medição confirmada pelo médico
  // registra o modelo extrator; senão é entrada manual ('human-edit').
  const modelVersion = String(formData.get('modelVersion') ?? '').trim();
  const origin = modelVersion
    ? { action: 'measurement-import', modelVersion }
    : { action: 'measurement-add' };

  if (kind === 'lab') {
    const values: LabExamValues = compact({
      ldl: parseDecimal(formData.get('ldl')),
      hba1c: parseDecimal(formData.get('hba1c')),
      insulina: parseDecimal(formData.get('insulina')),
    });
    if (Object.keys(values).length > 0) {
      await addLabExam(db, patientId, { measuredAt, values }, key, origin);
    }
  } else {
    const values: BodyCompositionValues = compact({
      peso: parseDecimal(formData.get('peso')),
      massaMuscular: parseDecimal(formData.get('massaMuscular')),
      massaGordura: parseDecimal(formData.get('massaGordura')),
      cintura: parseDecimal(formData.get('cintura')),
      imc: parseDecimal(formData.get('imc')),
      pgc: parseDecimal(formData.get('pgc')),
    });
    if (Object.keys(values).length > 0) {
      await addBodyComposition(db, patientId, { measuredAt, values }, key, origin);
    }
  }

  revalidatePath(`/patients/${patientId}/dashboard`);
  redirect(`/patients/${patientId}/dashboard?aba=${aba}`);
}
