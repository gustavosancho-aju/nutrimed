import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getConsultationMeta } from '@nutrimed/consent';
import { loadConsultationForm, EMPTY_FORM } from '@nutrimed/consultation-form';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import { PrintButton } from '@/components/print-button';
import { ConsultationFormSheet } from '@/components/consultation-form-sheet';

/**
 * Ficha de consulta em tela cheia — editável e imprimível. Mesmo padrão da nota
 * clínica: sem o chrome da consulta e com "Imprimir / Salvar PDF" pelo diálogo
 * nativo do navegador (@media print no componente esconde controles e achata os
 * campos em linhas), sem geração de PDF no servidor.
 *
 * A ficha abre mesmo quando ainda não foi gerada (EMPTY_FORM): o médico pode
 * preencher à mão a consulta que não teve áudio — a IA é o atalho, não o
 * caminho único.
 */
export default async function ConsultationFormPage({
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

  const stored = await loadConsultationForm(db, id, getEncryptionKey());

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-8 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/consultations/${id}`}
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ← Voltar à consulta
        </Link>
        <PrintButton />
      </div>

      <header className="mt-6 border-b border-ink/10 pb-5 print:mt-0 print:pb-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink print:text-xl">
          Ficha de consulta — Nutrologia
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {user.displayName} ·{' '}
          {meta.createdAt.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}
        </p>
      </header>

      <div className="mt-6 print:mt-4">
        <ConsultationFormSheet consultationId={id} form={stored?.form ?? EMPTY_FORM} />
      </div>

      {stored ? (
        <p className="mt-6 text-xs text-ink-muted print:hidden">
          Última atualização: {stored.updatedAt.toLocaleString('pt-BR')}
          {stored.modelVersion === 'human-edit' ? ' · revisada pelo médico' : ' · rascunho da IA'}
        </p>
      ) : null}
    </main>
  );
}
