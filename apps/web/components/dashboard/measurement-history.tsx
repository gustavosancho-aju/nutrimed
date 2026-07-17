import Link from 'next/link';
import type { Measurement } from '@nutrimed/patients';
import { deleteMeasurementAction } from '@/lib/measurement-actions';
import { ConfirmDeleteButton } from './confirm-delete-button';
import type { MeasurementField } from './measurement-form';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', dateStyle: 'short' });

/**
 * Histórico de medições da aba com Editar/Excluir por linha (feedback do
 * piloto 2026-07-15). Editar leva a `?editar=<id>` (o form da aba entra em modo
 * edição pré-preenchido); Excluir é SOFT-delete auditado com confirmação.
 */
export function MeasurementHistory<T extends object>({
  patientId,
  kind,
  aba,
  fields,
  measurements,
}: {
  patientId: string;
  kind: 'body' | 'lab';
  aba: 'bioimpedancia' | 'exames';
  fields: readonly MeasurementField[];
  measurements: readonly Measurement<T>[];
}) {
  if (measurements.length === 0) return null;
  // mais recentes primeiro na tabela (listMeasurements devolve ASC p/ gráficos)
  const rows = [...measurements].reverse();
  return (
    <div className="card-premium gold-hairline mt-6 overflow-x-auto p-5">
      <p className="text-sm font-medium text-ink">Histórico de medições</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-xs text-ink-muted">
            <th className="py-2 pr-4 font-medium">Data</th>
            {fields.map((f) => (
              <th key={f.name} className="py-2 pr-4 font-medium">
                {f.label}
              </th>
            ))}
            <th className="py-2 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-b border-ink/5 last:border-0">
              <td className="py-2 pr-4 text-ink">{dateFmt.format(m.measuredAt)}</td>
              {fields.map((f) => (
                <td key={f.name} className="py-2 pr-4 text-ink">
                  {(m.values as Record<string, number | undefined>)[f.name] ?? '—'}
                </td>
              ))}
              <td className="py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/patients/${patientId}/dashboard?aba=${aba}&editar=${m.id}`}
                    className="rounded-[8px] px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                  >
                    Editar
                  </Link>
                  <form action={deleteMeasurementAction}>
                    <input type="hidden" name="patientId" value={patientId} />
                    <input type="hidden" name="measurementId" value={m.id} />
                    <input type="hidden" name="kind" value={kind} />
                    <ConfirmDeleteButton />
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
