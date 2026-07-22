import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadPatient, computeAge, loadCurrentNutritionGoal } from '@nutrimed/patients';
import { listConsultationsByPatient } from '@nutrimed/consent';
import { getLinkStatus } from '@nutrimed/telegram-link';
import { setGoalAction } from '@/lib/telegram-actions';
import { startConsultationAction } from '@/lib/consent-actions';
import { deletePatientAction } from '@/lib/patient-settings-actions';
import { ConfirmDeleteButton } from '@/components/dashboard/confirm-delete-button';
import { TelegramLinkPanel } from '@/components/telegram-link-panel';

/** Formata uma data ISO/Date para dd/mm/aaaa (pt-BR), no servidor (estático). */
function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', dateStyle: 'short' }).format(d);
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  closed: 'Encerrada',
};

/**
 * Ficha do Paciente (E11/11.5 — FR24): dados + idade derivada + histórico de
 * consultas (links para a nota/resumo de E9) + entrada para a dashboard (Fase 3).
 * Valida posse: paciente de outro médico ⇒ notFound (sem vazamento).
 */
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const { erro } = await searchParams;
  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, id, key);
  if (!patient || patient.userId !== user.id) notFound();

  const consultations = await listConsultationsByPatient(db, id);
  const age = computeAge(patient.birthDate, new Date());
  const link = await getLinkStatus(db, id);
  const goal = await loadCurrentNutritionGoal(db, id, key);
  const goalFields = [
    { name: 'kcal', label: 'Calorias (kcal)', value: goal?.values.kcal },
    { name: 'protein', label: 'Proteína (g)', value: goal?.values.protein },
    { name: 'carbs', label: 'Carbo (g)', value: goal?.values.carbs },
    { name: 'fat', label: 'Gordura (g)', value: goal?.values.fat },
    { name: 'waterMl', label: 'Água (ml)', value: goal?.values.waterMl },
  ];
  const sleepFields = [
    { name: 'sleepMinHours', label: 'Sono mín. (h)', value: goal?.values.sleepMinHours },
    { name: 'sleepMaxHours', label: 'Sono máx. (h)', value: goal?.values.sleepMaxHours },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-[1880px] p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div className="min-w-0">
          <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
            ← Pacientes
          </Link>
          <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-ink xl:text-4xl">
            {patient.name}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <form action={deletePatientAction}>
            <input type="hidden" name="patientId" value={patient.id} />
            <ConfirmDeleteButton
              label="🗑 Excluir"
              message={`Excluir o paciente ${patient.name}? Ele sai das listagens; o histórico permanece guardado para fins de trilha.`}
              className="rounded-[10px] border border-red-300/60 px-3.5 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-400/10"
            />
          </form>
          <Link
            href={`/patients/${patient.id}/edit`}
            className="rounded-[10px] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            ✏️ Editar cadastro
          </Link>
          {/* Vai DIRETO à consulta deste paciente (gate de consentimento na própria
              tela da consulta) — sem passar pela tela genérica de nova consulta. */}
          <form action={startConsultationAction}>
            <input type="hidden" name="patientId" value={patient.id} />
            <button
              type="submit"
              className="rounded-[10px] bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            >
              + Nova consulta
            </button>
          </form>
        </div>
      </header>

      {erro && (
        <p
          role="alert"
          className="mt-6 rounded-[10px] border border-red-300/60 bg-red-400/10 px-4 py-2.5 text-sm text-red-700"
        >
          {erro}
        </p>
      )}

      {/* Em monitor (xl): duas colunas — dados+histórico | Telegram+metas — para
          aproveitar a largura com conteúdo, não só espaço em branco. */}
      <div className="mt-8 grid items-start gap-8 xl:grid-cols-2">
      <div className="space-y-8">
      {/* Dados do paciente */}
      <section className="card-premium gold-hairline p-7 xl:p-9">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4 xl:gap-y-6">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted xl:text-sm">Idade</dt>
            <dd className="mt-0.5 text-ink xl:text-2xl xl:font-medium">{age !== null ? `${age} anos` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted xl:text-sm">Nascimento</dt>
            <dd className="mt-0.5 text-ink xl:text-2xl xl:font-medium">{patient.birthDate ? formatDate(patient.birthDate) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted xl:text-sm">Telefone</dt>
            <dd className="mt-0.5 text-ink xl:text-2xl xl:font-medium">{patient.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted xl:text-sm">Profissão</dt>
            <dd className="mt-0.5 text-ink xl:text-2xl xl:font-medium">{patient.profession ?? '—'}</dd>
          </div>
        </dl>
        {patient.goal && (
          <div className="mt-5 rounded-[10px] border border-brand/20 bg-brand/5 p-4 xl:p-5">
            <p className="text-xs uppercase tracking-wide text-brand xl:text-sm">Principal objetivo</p>
            <p className="mt-1 font-medium text-ink xl:text-2xl">{patient.goal}</p>
          </div>
        )}
        <div className="mt-5">
          <Link
            href={`/patients/${patient.id}/dashboard`}
            className="inline-flex items-center gap-2 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 xl:px-5 xl:py-2.5 xl:text-base"
          >
            📊 Dashboard de evolução
          </Link>
        </div>
      </section>

      {/* Histórico de consultas */}
      <section>
        <h2 className="font-display text-base font-semibold text-ink xl:text-xl">Histórico de consultas</h2>
        {consultations.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted xl:text-base">Nenhuma consulta registrada ainda.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {consultations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/consultations/${c.id}`}
                  className="card-premium flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-muted xl:p-5"
                >
                  <span className="text-sm font-medium text-ink xl:text-lg">{formatDate(c.createdAt)}</span>
                  <span className="flex items-center gap-3">
                    <span className="rounded-full border border-ink/10 px-2.5 py-0.5 text-[11px] text-ink-muted xl:text-sm">
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                    <span aria-hidden className="text-ink-muted">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>

      {/* Assistente no Telegram + metas nutricionais (E12/12.4) */}
      <section className="card-premium gold-hairline p-7 xl:p-9">
        <h2 className="font-display text-base font-semibold text-ink xl:text-xl">Assistente no Telegram</h2>
        <p className="mt-1 text-sm text-ink-muted xl:text-base">
          Vincule o Telegram do paciente e defina as metas. Ele envia a foto do prato (/agua para
          água, /dormi e /acordei para o sono) e recebe o progresso frente às metas. O código de
          vínculo é o consentimento do paciente (revogável a qualquer momento).
        </p>
        <div className="mt-4">
          <TelegramLinkPanel patientId={patient.id} active={link?.granted ?? false} />
        </div>

        <div className="mt-6 border-t border-ink/10 pt-6">
          <h3 className="text-sm font-semibold text-ink xl:text-lg">Metas nutricionais</h3>
          {goal ? (
            <p className="mt-1 text-xs text-ink-muted xl:text-base">
              Atuais (desde {formatDate(goal.effectiveFrom)}): ~{Math.round(goal.values.kcal)} kcal · P{' '}
              {Math.round(goal.values.protein)} g · C {Math.round(goal.values.carbs)} g · G{' '}
              {Math.round(goal.values.fat)} g
              {goal.values.waterMl !== undefined ? ` · Água ${Math.round(goal.values.waterMl)} ml` : ''}
              {goal.values.sleepMinHours !== undefined && goal.values.sleepMaxHours !== undefined
                ? ` · Sono ${goal.values.sleepMinHours}–${goal.values.sleepMaxHours} h`
                : ''}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">Nenhuma meta definida ainda.</p>
          )}
          <form action={setGoalAction} className="mt-3">
            <input type="hidden" name="patientId" value={patient.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {goalFields.map((f) => (
                <label key={f.name} className="text-xs text-ink-muted">
                  {f.label}
                  <input
                    name={f.name}
                    type="number"
                    step="0.1"
                    min="0"
                    defaultValue={f.value ?? ''}
                    className="mt-1 w-full rounded-[8px] border border-ink/15 bg-surface px-2.5 py-1.5 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-xs">
              {sleepFields.map((f) => (
                <label key={f.name} className="text-xs text-ink-muted">
                  {f.label}
                  <input
                    name={f.name}
                    type="number"
                    step="0.5"
                    min="0"
                    defaultValue={f.value ?? ''}
                    className="mt-1 w-full rounded-[8px] border border-ink/15 bg-surface px-2.5 py-1.5 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs text-ink-muted">
                Vigência a partir de
                <input
                  name="effectiveFrom"
                  type="date"
                  defaultValue={goal?.effectiveFrom ?? ''}
                  className="mt-1 block rounded-[8px] border border-ink/15 bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                Salvar metas
              </button>
            </div>
          </form>
        </div>
      </section>
      </div>
    </main>
  );
}
