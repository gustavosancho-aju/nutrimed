import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createPatientAction } from '@/lib/patient-settings-actions';

/**
 * Cadastro dedicado de paciente (briefing do piloto 2026-07-19): a home passa a
 * ter "+ Novo paciente" e a consulta nasce da FICHA do paciente — o cadastro
 * deixa de estar acoplado à abertura de consulta. Submete para
 * createPatientAction (PII cifrada + audit) e leva à ficha recém-criada.
 */
export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { erro } = await searchParams;

  const inputClass =
    'w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
          ← Pacientes
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Novo paciente
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Cadastre o paciente; a primeira consulta parte da ficha dele.
        </p>
      </header>

      {erro && (
        <p
          role="alert"
          className="mt-6 rounded-[10px] border border-red-300/60 bg-red-400/10 px-4 py-2.5 text-sm text-red-700"
        >
          {erro}
        </p>
      )}

      <form action={createPatientAction} className="card-premium gold-hairline mt-8 space-y-4 p-7">
        <label className="block space-y-1">
          <span className="text-xs text-ink-muted">Nome *</span>
          <input name="name" type="text" required className={inputClass} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">Data de nascimento</span>
            <input name="birthDate" type="date" className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">Telefone</span>
            <input name="phone" type="tel" className={inputClass} />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">Altura (cm)</span>
            <input
              name="heightCm"
              type="number"
              step="0.1"
              min="80"
              max="250"
              placeholder="ex.: 172"
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-ink-muted">Profissão</span>
            <input name="profession" type="text" className={inputClass} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-ink-muted">Principal objetivo</span>
          <input name="goal" type="text" className={inputClass} />
        </label>
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Cadastrar paciente
          </button>
          <Link
            href="/"
            className="rounded-[10px] border border-ink/15 px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
