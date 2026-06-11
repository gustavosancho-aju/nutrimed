import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/auth-actions';
import { startConsultationAction } from '@/lib/consent-actions';
import { DisclaimerNote } from '@/components/disclaimer-note';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">NutriMed</h1>
          <p className="text-sm text-gray-500">Painel do nutrólogo</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Sair
          </button>
        </form>
      </header>

      <section className="mt-8 space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">
          Bem-vinda, {user.displayName}
        </h2>
        <p className="text-sm text-gray-600">
          Você está autenticado como <strong>{user.email}</strong>.
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700">Nova consulta</h3>
        <p className="mt-1 text-sm text-gray-500">
          Abra uma consulta para registrar o consentimento de gravação antes de iniciar o board.
        </p>
        <form action={startConsultationAction} className="mt-4 flex gap-2">
          <input
            name="patientLabel"
            type="text"
            placeholder="Rótulo do paciente (cifrado em repouso)"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Iniciar consulta
          </button>
        </form>
      </section>

      <footer className="mt-10 border-t border-gray-200 pt-4">
        <DisclaimerNote />
      </footer>
    </main>
  );
}
