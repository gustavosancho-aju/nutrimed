import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getConsultationMeta } from '@nutrimed/consent';
import { loadPatient } from '@nutrimed/patients';
import { loadNote } from '@nutrimed/clinical-notes';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { PrintButton } from '@/components/print-button';

/**
 * Nota clínica em tela cheia (briefing do piloto 2026-07-19): tipografia
 * grande, sem o chrome da consulta, com um botão "Imprimir / Salvar PDF" que
 * usa o diálogo nativo do navegador (CSS @media print abaixo esconde tudo
 * que não é a nota) — sem dependência de geração de PDF no servidor.
 */
export default async function ConsultationNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getDb();
  const meta = await getConsultationMeta(db, id, user.id);
  if (!meta) notFound();

  const key = getEncryptionKey();
  const note = await loadNote(db, id, key);
  if (!note) notFound();
  const patient = meta.patientId ? await loadPatient(db, meta.patientId, key) : null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/consultations/${id}`}
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ← Voltar à consulta
        </Link>
        <PrintButton />
      </div>

      <header className="mt-6 border-b border-ink/10 pb-5 print:mt-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Nota clínica
        </h1>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink-muted sm:grid-cols-3">
          {patient && (
            <div>
              <dt className="inline text-xs uppercase tracking-wide">Paciente: </dt>
              <dd className="inline">{patient.name}</dd>
            </div>
          )}
          <div>
            <dt className="inline text-xs uppercase tracking-wide">Consulta: </dt>
            <dd className="inline">
              {meta.createdAt.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}
            </dd>
          </div>
          <div>
            <dt className="inline text-xs uppercase tracking-wide">Médico(a): </dt>
            <dd className="inline">{user.displayName}</dd>
          </div>
        </dl>
      </header>

      <article className="prose prose-sm mt-6 max-w-none whitespace-pre-wrap text-base leading-relaxed text-ink print:mt-4 print:text-sm">
        {note.content}
      </article>

      <p className="mt-8 text-xs text-ink-muted print:hidden">
        Última atualização: {note.updatedAt.toLocaleString('pt-BR')}
      </p>
    </main>
  );
}
