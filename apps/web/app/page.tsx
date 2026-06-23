import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/auth-actions';
import { startConsultationAction } from '@/lib/consent-actions';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { listPatients, computeAge } from '@nutrimed/patients';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const db = await getDb();
  const patients = await listPatients(db, user.id, getEncryptionKey());
  const now = new Date();

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
          Selecione um paciente existente <strong className="text-ink">ou</strong> cadastre um novo.
          A consulta nasce vinculada ao paciente, com o consentimento de gravação pendente.
        </p>

        <form action={startConsultationAction} className="mt-5 space-y-5">
          {patients.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="patientId" className="text-sm font-medium text-ink">
                Paciente existente
              </label>
              <select
                id="patientId"
                name="patientId"
                defaultValue=""
                className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                <option value="">— Cadastrar novo paciente —</option>
                {patients.map((p) => {
                  const age = computeAge(p.birthDate, now);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {age !== null ? ` · ${age} anos` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <fieldset className="space-y-3 border-t border-ink/10 pt-4">
            <legend className="text-sm font-medium text-ink">Novo paciente</legend>
            <input
              name="patientName"
              type="text"
              placeholder="Nome completo"
              autoComplete="off"
              className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex-1 space-y-1">
                <span className="text-xs text-ink-muted">Data de nascimento</span>
                <input
                  name="patientBirthDate"
                  type="date"
                  className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="flex-1 space-y-1">
                <span className="text-xs text-ink-muted">Telefone</span>
                <input
                  name="patientPhone"
                  type="tel"
                  placeholder="(11) 99999-0000"
                  className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
            </div>
            <input
              name="patientGoal"
              type="text"
              placeholder="Principal objetivo (opcional)"
              className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </fieldset>

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
