import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadPatient, computeAge, loadCurrentNutritionGoal } from '@nutrimed/patients';
import { listConsultationsByPatient } from '@nutrimed/consent';
import { getLinkStatus } from '@nutrimed/telegram-link';
import { setGoalAction } from '@/lib/telegram-actions';
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
  ];

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div className="min-w-0">
          <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
            ← Pacientes
          </Link>
          <h1 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-ink">
            {patient.name}
          </h1>
        </div>
        <Link
          href="/consultations/new"
          className="shrink-0 rounded-[10px] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
        >
          + Nova consulta
        </Link>
      </header>

      {erro && (
        <p
          role="alert"
          className="mt-6 rounded-[10px] border border-red-300/60 bg-red-400/10 px-4 py-2.5 text-sm text-red-700"
        >
          {erro}
        </p>
      )}

      {/* Dados do paciente */}
      <section className="card-premium gold-hairline mt-8 p-7">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Idade</dt>
            <dd className="mt-0.5 text-ink">{age !== null ? `${age} anos` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Nascimento</dt>
            <dd className="mt-0.5 text-ink">{patient.birthDate ? formatDate(patient.birthDate) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Telefone</dt>
            <dd className="mt-0.5 text-ink">{patient.phone ?? '—'}</dd>
          </div>
        </dl>
        {patient.goal && (
          <div className="mt-5 rounded-[10px] border border-brand/20 bg-brand/5 p-4">
            <p className="text-xs uppercase tracking-wide text-brand">Principal objetivo</p>
            <p className="mt-1 font-medium text-ink">{patient.goal}</p>
          </div>
        )}
        <div className="mt-5">
          <Link
            href={`/patients/${patient.id}/dashboard`}
            className="inline-flex items-center gap-2 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            📊 Dashboard de evolução
          </Link>
        </div>
      </section>

      {/* Assistente no Telegram + metas nutricionais (E12/12.4) */}
      <section className="card-premium gold-hairline mt-8 p-7">
        <h2 className="font-display text-base font-semibold text-ink">Assistente no Telegram</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Vincule o Telegram do paciente e defina as metas. Ele envia a foto do prato e recebe a
          estimativa nutricional frente às metas. O código de vínculo é o consentimento do paciente
          (revogável a qualquer momento).
        </p>
        <div className="mt-4">
          <TelegramLinkPanel patientId={patient.id} active={link?.granted ?? false} />
        </div>

        <div className="mt-6 border-t border-ink/10 pt-6">
          <h3 className="text-sm font-semibold text-ink">Metas nutricionais</h3>
          {goal ? (
            <p className="mt-1 text-xs text-ink-muted">
              Atuais (desde {formatDate(goal.effectiveFrom)}): ~{Math.round(goal.values.kcal)} kcal · P{' '}
              {Math.round(goal.values.protein)} g · C {Math.round(goal.values.carbs)} g · G{' '}
              {Math.round(goal.values.fat)} g
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-muted">Nenhuma meta definida ainda.</p>
          )}
          <form action={setGoalAction} className="mt-3">
            <input type="hidden" name="patientId" value={patient.id} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      {/* Histórico de consultas */}
      <section className="mt-8">
        <h2 className="font-display text-base font-semibold text-ink">Histórico de consultas</h2>
        {consultations.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nenhuma consulta registrada ainda.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {consultations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/consultations/${c.id}`}
                  className="card-premium flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-muted"
                >
                  <span className="text-sm font-medium text-ink">{formatDate(c.createdAt)}</span>
                  <span className="flex items-center gap-3">
                    <span className="rounded-full border border-ink/10 px-2.5 py-0.5 text-[11px] text-ink-muted">
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
    </main>
  );
}
