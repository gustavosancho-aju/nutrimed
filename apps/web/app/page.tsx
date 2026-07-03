import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { logoutAction } from '@/lib/auth-actions';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { listPatients, computeAge } from '@nutrimed/patients';

/**
 * Home (E11/11.4): lista de pacientes do médico. Cada paciente leva à sua ficha
 * (/patients/[id]); o CTA "Nova consulta" leva ao fluxo de seleção/cadastro.
 */
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

      <section className="mt-10 flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-semibold text-ink">
            Bem-vinda, {user.displayName}
          </h2>
          <p className="text-sm text-ink-muted">
            {patients.length > 0
              ? `${patients.length} ${patients.length === 1 ? 'paciente' : 'pacientes'} em acompanhamento.`
              : 'Você ainda não tem pacientes.'}
          </p>
        </div>
        <Link
          href="/consultations/new"
          className="shrink-0 rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          + Nova consulta
        </Link>
      </section>

      {patients.length === 0 ? (
        <section className="card-premium gold-hairline mt-8 p-10 text-center">
          <h3 className="font-display text-base font-semibold text-ink">Comece pelo primeiro paciente</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            Inicie uma nova consulta para cadastrar um paciente. Ele passa a integrar seu
            acompanhamento longitudinal — consultas, evolução e dashboard.
          </p>
          <Link
            href="/consultations/new"
            className="mt-5 inline-block rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Iniciar primeira consulta
          </Link>
        </section>
      ) : (
        <ul className="mt-8 space-y-3">
          {patients.map((p) => {
            const age = computeAge(p.birthDate, now);
            return (
              <li key={p.id}>
                <Link
                  href={`/patients/${p.id}`}
                  className="card-premium gold-hairline flex items-center justify-between gap-4 p-5 transition-colors hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-semibold text-ink">{p.name}</p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">
                      {age !== null ? `${age} anos` : 'idade não informada'}
                      {p.goal ? ` · ${p.goal}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {p.phone && <span className="text-sm text-ink-muted">{p.phone}</span>}
                    <span aria-hidden className="text-ink-muted">→</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
