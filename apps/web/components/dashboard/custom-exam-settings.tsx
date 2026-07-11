import { setCustomExamsAction } from '@/lib/patient-settings-actions';
import type { CustomExamDef } from '@nutrimed/patients';

const SLOTS = [1, 2, 3] as const;

const INPUT_CLASS =
  'w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * Configuração dos exames personalizados do paciente (até 3 slots com nome e
 * unidade definidos pelo médico — ex.: TSH, Vitamina D, Ferritina). Slots sem
 * nome não aparecem no formulário de medição nem nos cards. Submete para
 * `setCustomExamsAction` (cifra + audita).
 */
export function CustomExamSettings({
  patientId,
  defs,
}: {
  patientId: string;
  defs: readonly CustomExamDef[];
}) {
  const bySlot = new Map(defs.map((d) => [d.slot, d]));

  return (
    <details className="card-premium gold-hairline mt-6 p-5">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        Exames personalizados
      </summary>
      <form action={setCustomExamsAction} className="mt-3">
        <input type="hidden" name="patientId" value={patientId} />
        <p className="text-xs text-ink-muted">
          Defina até 3 exames próprios deste paciente (ex.: TSH, Vitamina D, Ferritina). Slots sem
          nome não aparecem no formulário nem nos cards.
        </p>
        <div className="mt-3 space-y-3">
          {SLOTS.map((slot) => {
            const def = bySlot.get(slot);
            return (
              <div key={slot} className="grid grid-cols-[1fr_140px] gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-ink-muted">Nome do exame {slot}</span>
                  <input
                    name={`name${slot}`}
                    type="text"
                    maxLength={60}
                    placeholder="—"
                    defaultValue={def?.name ?? ''}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-ink-muted">Unidade (opcional)</span>
                  <input
                    name={`unit${slot}`}
                    type="text"
                    maxLength={12}
                    placeholder="ex.: ng/mL"
                    defaultValue={def?.unit ?? ''}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-ink-muted">
          Renomear um slot altera o rótulo de todo o histórico daquele slot.
        </p>
        <button
          type="submit"
          className="mt-4 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Salvar exames personalizados
        </button>
      </form>
    </details>
  );
}
