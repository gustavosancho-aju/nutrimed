import { setBodyGoalAction } from '@/lib/patient-settings-actions';
import type { BodyGoal } from '@nutrimed/patients';

const INPUT_CLASS =
  'w-full rounded-[10px] border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

const FIELDS: { name: keyof BodyGoal['values']; label: string; unit?: string }[] = [
  { name: 'peso', label: 'Peso', unit: 'kg' },
  { name: 'imc', label: 'IMC' },
  { name: 'massaMuscular', label: 'Massa Muscular', unit: 'kg' },
  { name: 'massaGordura', label: 'Massa de Gordura', unit: 'kg' },
  { name: 'cintura', label: 'Cintura', unit: 'cm' },
  { name: 'pgc', label: 'PGC', unit: '%' },
];

/** dd/mm/aaaa (pt-BR) — a data ISO vem do banco (effective_from). */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Configuração das metas corporais do paciente (definidas pelo médico,
 * versionadas por append). Campos vazios ficam sem meta — Peso e IMC continuam
 * usando a referência OMS como padrão. Submete para `setBodyGoalAction`.
 */
export function BodyGoalSettings({
  patientId,
  goal,
  defaultDate,
}: {
  patientId: string;
  goal: BodyGoal | null;
  defaultDate: string;
}) {
  return (
    <details className="card-premium gold-hairline mt-6 p-5">
      <summary className="cursor-pointer text-sm font-medium text-ink">Metas corporais</summary>
      <form action={setBodyGoalAction} className="mt-3">
        <input type="hidden" name="patientId" value={patientId} />
        <p className="text-xs text-ink-muted">
          {goal
            ? `Metas atuais (desde ${fmtDate(goal.effectiveFrom)}). Salvar cria uma nova versão vigente.`
            : 'Defina metas numéricas para este paciente.'}{' '}
          Campos vazios ficam sem meta — Peso e IMC continuam usando a referência OMS como padrão.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FIELDS.map((f) => (
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
                defaultValue={goal?.values[f.name] ?? ''}
                className={INPUT_CLASS}
              />
            </label>
          ))}
          <label className="space-y-1">
            <span className="text-xs text-ink-muted">Vigência a partir de</span>
            <input name="effectiveFrom" type="date" defaultValue={defaultDate} className={INPUT_CLASS} />
          </label>
        </div>
        <button
          type="submit"
          className="mt-4 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Salvar metas corporais
        </button>
      </form>
    </details>
  );
}
