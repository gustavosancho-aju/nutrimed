import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadPatient } from '@nutrimed/patients';
import { updatePatientAction } from '@/lib/patient-settings-actions';

/**
 * Edição dos dados cadastrais do paciente (feedback do piloto 2026-07-15).
 * Form pré-preenchido (PII decifrada server-side); submete para
 * updatePatientAction (recifra + audita 'patient-edit'). Valida posse.
 */
export default async function EditPatientPage({
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
  const patient = await loadPatient(db, id, getEncryptionKey());
  if (!patient || patient.userId !== user.id) notFound();

  const inputClass =
    'w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link
          href={`/patients/${id}`}
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ← {patient.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Editar cadastro
        </h1>
      </header>

      {erro && (
        <p
          role="alert"
          className="mt-6 rounded-[10px] border border-red-300/60 bg-red-400/10 px-4 py-2.5 text-sm text-red-700"
        >
          {erro}
        </p>
      )}

      <form action={updatePatientAction} className="card-premium gold-hairline mt-8 space-y-4 p-7">
        <input type="hidden" name="patientId" value={id} />
        <label className="block space-y-1">
          <span className="text-xs text-ink-muted">Nome *</span>
          <input name="name" type="text" required defaultValue={patient.name} className={inputClass} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">Data de nascimento</span>
            <input
              name="birthDate"
              type="date"
              defaultValue={patient.birthDate ?? ''}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">Telefone</span>
            <input name="phone" type="tel" defaultValue={patient.phone ?? ''} className={inputClass} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-ink-muted">Principal objetivo</span>
          <input name="goal" type="text" defaultValue={patient.goal ?? ''} className={inputClass} />
        </label>
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Salvar cadastro
          </button>
          <Link
            href={`/patients/${id}`}
            className="rounded-[10px] border border-ink/15 px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
