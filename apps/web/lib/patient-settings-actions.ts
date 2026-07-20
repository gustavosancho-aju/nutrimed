'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  loadPatient,
  createPatient,
  updatePatient,
  softDeletePatient,
  setCustomExamDefs,
  setBodyGoal,
  type CustomExamDef,
  type BodyGoalValues,
} from '@nutrimed/patients';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';
import { parseDecimal } from './dashboard';
import { checkRanges } from './measurement-ranges';

/**
 * Server actions de configuração do paciente na dashboard (exames
 * personalizados + metas corporais). Toda ação valida a POSSE do paciente
 * (escopo por médico) e reusa os serviços cifrados+auditados de
 * @nutrimed/patients — mesmo padrão de telegram-actions.ts.
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

/** Remove chaves undefined — uma meta parcial (só alguns campos) é válida. */
function compact<T extends Record<string, number | undefined>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Edição dos dados cadastrais do paciente (feedback do piloto): liga o
 * updatePatient já existente no pacote (recifra PII + audita 'patient-edit').
 */
export async function updatePatientAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { db } = await assertOwner(patientId);

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    redirect(`/patients/${patientId}/edit?erro=${encodeURIComponent('O nome é obrigatório.')}`);
  }
  const birthDate = String(formData.get('birthDate') ?? '').trim() || undefined;
  const phone = String(formData.get('phone') ?? '').trim() || undefined;
  const goal = String(formData.get('goal') ?? '').trim() || undefined;
  const profession = String(formData.get('profession') ?? '').trim() || undefined;
  const heightCm = parseHeightCm(formData.get('heightCm'));
  if (heightCm === 'invalid') {
    redirect(
      `/patients/${patientId}/edit?erro=${encodeURIComponent('Altura inválida — informe em cm (ex.: 172), entre 80 e 250.')}`,
    );
  }

  await updatePatient(
    db,
    patientId,
    { name, birthDate, phone, goal, profession, heightCm },
    getEncryptionKey(),
  );

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

/** Altura em cm: vazio ⇒ undefined; fora de 80–250 ⇒ 'invalid'. */
function parseHeightCm(raw: FormDataEntryValue | null): number | undefined | 'invalid' {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 80 || n > 250) return 'invalid';
  return Math.round(n * 10) / 10;
}

/**
 * Cadastro dedicado de paciente (briefing do piloto — "Novo paciente" na home).
 * Reusa createPatient (PII cifrada + audit 'patient-create') e leva à ficha.
 */
export async function createPatientAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = await getDb();

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    redirect(`/patients/new?erro=${encodeURIComponent('O nome é obrigatório.')}`);
  }
  const birthDate = String(formData.get('birthDate') ?? '').trim() || undefined;
  const phone = String(formData.get('phone') ?? '').trim() || undefined;
  const goal = String(formData.get('goal') ?? '').trim() || undefined;
  const profession = String(formData.get('profession') ?? '').trim() || undefined;
  const heightCm = parseHeightCm(formData.get('heightCm'));
  if (heightCm === 'invalid') {
    redirect(
      `/patients/new?erro=${encodeURIComponent('Altura inválida — informe em cm (ex.: 172), entre 80 e 250.')}`,
    );
  }

  const patientId = await createPatient(
    db,
    user.id,
    { name, birthDate, phone, goal, profession, heightCm },
    getEncryptionKey(),
  );
  revalidatePath('/');
  redirect(`/patients/${patientId}`);
}

/**
 * Exclusão (soft) do paciente — a ficha some das listagens; o histórico
 * permanece no banco para trilha/retensão (CJ-2) e a exclusão é auditada.
 */
export async function deletePatientAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { user, db } = await assertOwner(patientId);

  await softDeletePatient(db, user.id, patientId);
  revalidatePath('/');
  redirect('/');
}

const SLOTS = [1, 2, 3] as const;

/**
 * Salva os exames personalizados do paciente (até 3 slots com nome/unidade).
 * Slot com nome vazio é removido — os valores históricos do slot permanecem no
 * banco e voltam a aparecer se o slot for renomeado.
 */
export async function setCustomExamsAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { db } = await assertOwner(patientId);

  const defs: CustomExamDef[] = [];
  for (const slot of SLOTS) {
    const name = String(formData.get(`name${slot}`) ?? '').trim().slice(0, 60);
    if (!name) continue;
    const unit = String(formData.get(`unit${slot}`) ?? '').trim().slice(0, 12);
    defs.push(unit ? { slot, name, unit } : { slot, name });
  }
  await setCustomExamDefs(db, patientId, defs, getEncryptionKey());

  revalidatePath(`/patients/${patientId}/dashboard`);
  redirect(`/patients/${patientId}/dashboard?aba=exames`);
}

/**
 * Define metas corporais (nova versão vigente a partir da data informada —
 * append, cifrada e auditada). Todos os campos vazios ⇒ não grava nada.
 */
export async function setBodyGoalAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { user, db } = await assertOwner(patientId);

  const values: BodyGoalValues = compact({
    peso: parseDecimal(formData.get('peso')),
    imc: parseDecimal(formData.get('imc')),
    massaMuscular: parseDecimal(formData.get('massaMuscular')),
    massaGordura: parseDecimal(formData.get('massaGordura')),
    cintura: parseDecimal(formData.get('cintura')),
    pgc: parseDecimal(formData.get('pgc')),
  });
  const rangeError = checkRanges({ ...values });
  if (rangeError) {
    redirect(`/patients/${patientId}/dashboard?aba=bioimpedancia&erro=${encodeURIComponent(rangeError)}`);
  }
  if (Object.keys(values).length > 0) {
    const dateRaw = String(formData.get('effectiveFrom') ?? '').trim();
    const effectiveFrom = dateRaw || new Date().toISOString().slice(0, 10);
    await setBodyGoal(db, patientId, user.id, effectiveFrom, values, getEncryptionKey());
  }

  revalidatePath(`/patients/${patientId}/dashboard`);
  redirect(`/patients/${patientId}/dashboard?aba=bioimpedancia`);
}
