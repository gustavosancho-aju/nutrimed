'use client';

import { useActionState } from 'react';
import { generateNutritionReportAction } from '@/lib/nutrition-report-actions';
import { ACTION_ERROR_MESSAGES, type ActionErrorCode } from '@/lib/action-result';

/** Mensagens no CONTEXTO do relatório nutricional. */
const REPORT_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  ...ACTION_ERROR_MESSAGES,
  'no-transcript':
    'Sem transcrição nesta sessão — inicie a consulta ao vivo antes de gerar o relatório.',
  internal:
    'Falha inesperada ao gerar o relatório — tente novamente; se persistir, contate o suporte.',
};

/**
 * Botão "Gerar relatório nutricional" (E13): mesma mecânica da nota clínica —
 * useActionState + ActionResult para o erro chegar legível em pt-BR.
 */
export function NutritionReportForm({
  consultationId,
  hasReport,
}: {
  consultationId: string;
  hasReport: boolean;
}) {
  const [result, formAction, pending] = useActionState(generateNutritionReportAction, null);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="consultationId" value={consultationId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          ✨ {pending ? 'Gerando…' : hasReport ? 'Regenerar relatório' : 'Gerar relatório nutricional'}
        </button>
      </form>
      {result && !result.ok ? (
        <p className="max-w-[280px] text-right text-[11px] text-red-600">
          {REPORT_ERROR_MESSAGES[result.code]}
        </p>
      ) : null}
    </div>
  );
}
