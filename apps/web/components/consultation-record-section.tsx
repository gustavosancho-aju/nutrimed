import type { ConsultationRecord } from '@nutrimed/clinical-notes';
import { saveConsultationRecordAction } from '@/lib/record-actions';

const updatedFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/**
 * Prontuário manual da consulta: Conduta + Anotações do médico (ciclo 2).
 * Renderizado nos DOIS modos da página (ao vivo e releitura) — o médico pode
 * preencher durante a consulta ou ao reler depois. 100% manual, nunca IA.
 */
export function ConsultationRecordSection({
  consultationId,
  record,
}: {
  consultationId: string;
  record: ConsultationRecord | null;
}) {
  const textareaClass =
    'mt-2 w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
  return (
    <section className="card-premium gold-hairline mt-8 p-7">
      <h2 className="font-display text-base font-semibold text-ink">🩺 Conduta e anotações</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Campos manuais do médico — cifrados em repouso e auditados. Nada aqui é gerado por IA.
      </p>
      <form action={saveConsultationRecordAction} key={record?.updatedAt.getTime() ?? 'new'}>
        <input type="hidden" name="consultationId" value={consultationId} />
        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Conduta</span>
          <textarea
            name="conduct"
            rows={4}
            defaultValue={record?.conduct ?? ''}
            placeholder="Conduta definida pelo médico para esta consulta…"
            className={textareaClass}
          />
        </label>
        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Anotações do médico
          </span>
          <textarea
            name="annotations"
            rows={4}
            defaultValue={record?.annotations ?? ''}
            placeholder="Anotações livres desta consulta — visíveis ao reabrir o registro…"
            className={textareaClass}
          />
        </label>
        <div className="mt-4 flex items-center justify-between gap-3">
          {record ? (
            <p className="text-xs text-ink-muted">
              Última atualização: {updatedFmt.format(record.updatedAt)}
            </p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            💾 Salvar conduta e anotações
          </button>
        </div>
      </form>
    </section>
  );
}
