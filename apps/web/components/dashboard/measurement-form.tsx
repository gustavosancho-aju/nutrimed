import { addMeasurementAction } from '@/lib/measurement-actions';

export interface MeasurementField {
  readonly name: string;
  readonly label: string;
  readonly unit?: string;
}

/**
 * Form de entrada manual de medição (E11/11.6) — caminho primário da dashboard.
 * Todos os campos numéricos são opcionais (medição parcial é válida); a data
 * default é hoje. Submete para `addMeasurementAction` (cifra + audita).
 */
export function MeasurementForm({
  patientId,
  kind,
  fields,
  defaultDate,
}: {
  patientId: string;
  kind: 'body' | 'lab';
  fields: readonly MeasurementField[];
  defaultDate: string;
}) {
  return (
    <form action={addMeasurementAction} className="card-premium gold-hairline mt-6 p-5">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="kind" value={kind} />
      <p className="text-sm font-medium text-ink">Nova medição</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs text-ink-muted">Data</span>
          <input
            name="measuredAt"
            type="date"
            defaultValue={defaultDate}
            className="w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </label>
        {fields.map((f) => (
          <label key={f.name} className="space-y-1">
            <span className="text-xs text-ink-muted">
              {f.label}
              {f.unit ? ` (${f.unit})` : ''}
            </span>
            <input
              name={f.name}
              type="text"
              inputMode="decimal"
              placeholder="—"
              className="w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        className="mt-4 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
      >
        Adicionar medição
      </button>
    </form>
  );
}
