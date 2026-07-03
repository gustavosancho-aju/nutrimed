'use client';

import { useActionState } from 'react';
import { generateNoteAction } from '@/lib/note-actions';
import { ACTION_ERROR_MESSAGES, type ActionErrorCode } from '@/lib/action-result';

/** Mensagens no CONTEXTO da nota — 'internal' genérico falava do fluxo errado. */
const NOTE_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  ...ACTION_ERROR_MESSAGES,
  internal: 'Falha inesperada ao gerar a nota — tente novamente; se persistir, contate o suporte.',
};

/**
 * Botão "Gerar nota" com useActionState (E9): a action retorna ActionResult e a
 * mensagem de erro (ex.: sem transcrição) aparece em pt-BR ao lado do botão —
 * um throw seria mascarado pelo Next em produção.
 */
export function NoteGeneratorForm({
  consultationId,
  hasNote,
}: {
  consultationId: string;
  hasNote: boolean;
}) {
  const [result, formAction, pending] = useActionState(generateNoteAction, null);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="consultationId" value={consultationId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          ✨ {pending ? 'Gerando…' : hasNote ? 'Regenerar rascunho' : 'Gerar nota da consulta'}
        </button>
      </form>
      {result && !result.ok ? (
        <p className="max-w-[280px] text-right text-[11px] text-red-600">
          {NOTE_ERROR_MESSAGES[result.code]}
        </p>
      ) : null}
    </div>
  );
}
