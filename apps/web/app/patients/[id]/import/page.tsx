import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadPatient } from '@nutrimed/patients';
import { ImportLaudoPanel } from '@/components/dashboard/import-laudo-panel';

/**
 * Importação de laudo (E11 Fase 4 / ADR-012). Sobe o PDF, a IA extrai um
 * rascunho e o médico confirma antes de salvar (validação obrigatória). Valida
 * posse do paciente.
 */
export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getDb();
  const patient = await loadPatient(db, id, getEncryptionKey());
  if (!patient || patient.userId !== user.id) notFound();

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link
          href={`/patients/${id}/dashboard`}
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">
          Importar laudo (PDF)
        </h1>
        <p className="text-sm text-ink-muted">
          {patient.name} — a IA lê o laudo e pré-preenche os valores; você confere e confirma.
        </p>
      </header>

      <section className="mt-8">
        <ImportLaudoPanel patientId={id} today={today} />
      </section>
    </main>
  );
}
