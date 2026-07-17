import { addMeasurementAction, updateMeasurementAction } from '@/lib/measurement-actions';

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
  defaults,
  modelVersion,
  title = 'Nova medição',
  measurementId,
}: {
  patientId: string;
  kind: 'body' | 'lab';
  fields: readonly MeasurementField[];
  defaultDate: string;
  /** Pré-preenchimento (ex.: rascunho de uma importação — Story 11.10). */
  defaults?: Record<string, number | string | undefined>;
  /** Proveniência da extração para a auditoria (NFR10); ausente ⇒ entrada manual. */
  modelVersion?: string;
  title?: string;
  /** Modo edição: id da medição existente — troca a action para update (recifra + audita). */
  measurementId?: string;
}) {
  return (
    <form
      action={measurementId ? updateMeasurementAction : addMeasurementAction}
      className="card-premium gold-hairline mt-6 p-5"
    >
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="kind" value={kind} />
      {measurementId && <input type="hidden" name="measurementId" value={measurementId} />}
      {modelVersion && <input type="hidden" name="modelVersion" value={modelVersion} />}
      <p className="text-sm font-medium text-ink">{title}</p>
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
              defaultValue={defaults?.[f.name] ?? ''}
              className="w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        className="mt-4 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
      >
        {measurementId ? 'Salvar alterações' : 'Adicionar medição'}
      </button>
    </form>
  );
}
