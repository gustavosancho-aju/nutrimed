import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/auth-actions';
import { startConsultationAction } from '@/lib/consent-actions';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-ink/10 pb-5">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">NutriMed</h1>
          <p className="text-sm text-ink-muted">Painel do nutrólogo</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-[10px] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            Sair
          </button>
        </form>
      </header>

      <section className="mt-10 space-y-1">
        <h2 className="font-display text-xl font-semibold text-ink">
          Bem-vinda, {user.displayName}
        </h2>
        <p className="text-sm text-ink-muted">
          Você está autenticado como <strong className="text-ink">{user.email}</strong>.
        </p>
      </section>

      <section className="card-premium gold-hairline mt-8 p-7">
        <h3 className="font-display text-base font-semibold text-ink">Nova consulta</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Abra uma consulta para registrar o consentimento de gravação antes de iniciar o board.
        </p>
        <form action={startConsultationAction} className="mt-5 flex gap-2">
          <input
            name="patientLabel"
            type="text"
            placeholder="Rótulo do paciente (cifrado em repouso)"
            className="flex-1 rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <button
            type="submit"
            className="rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Iniciar consulta
          </button>
        </form>
      </section>
    </main>
  );
}
