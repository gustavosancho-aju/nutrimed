'use client';

import { useActionState } from 'react';
import { generateConsultationFormAction } from '@/lib/consultation-form-actions';
import { ACTION_ERROR_MESSAGES, type ActionErrorCode } from '@/lib/action-result';
import { IconSparkle } from '@/components/icons';

/** Mensagens no CONTEXTO da ficha (as genéricas falam do fluxo da NOTA). */
const FORM_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  ...ACTION_ERROR_MESSAGES,
  internal: 'Falha inesperada ao preencher a ficha — tente novamente; se persistir, contate o suporte.',
  'no-transcript':
    'Sem transcrição nesta sessão — rode a consulta antes de gerar, ou abra a ficha e preencha à mão.',
};

/**
 * Botão "Preencher ficha da consulta" (useActionState, como o da nota): a
 * action devolve ActionResult e o erro aparece em pt-BR ao lado do botão — um
 * throw seria mascarado pelo Next em produção.
 */
export function ConsultationFormGenerator({
  consultationId,
  hasForm,
}: {
  consultationId: string;
  hasForm: boolean;
}) {
  const [result, formAction, pending] = useActionState(generateConsultationFormAction, null);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="consultationId" value={consultationId} />
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-[10px] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          <IconSparkle className="h-3.5 w-3.5" />{' '}
          {pending ? 'Preenchendo…' : hasForm ? 'Regenerar rascunho' : 'Preencher ficha da consulta'}
        </button>
      </form>
      {result && !result.ok ? (
        <p className="max-w-[280px] text-right text-[11px] text-red-600">
          {FORM_ERROR_MESSAGES[result.code]}
        </p>
      ) : null}
    </div>
  );
}
