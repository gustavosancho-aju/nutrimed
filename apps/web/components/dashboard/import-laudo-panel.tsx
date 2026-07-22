'use client';

import { useActionState } from 'react';
import { extractLaudoAction, type ImportState } from '@/lib/import-actions';
import { MeasurementForm, type MeasurementField } from './measurement-form';

const BODY_FIELDS: MeasurementField[] = [
  { name: 'peso', label: 'Peso', unit: 'kg' },
  { name: 'massaMuscular', label: 'Massa Muscular', unit: 'kg' },
  { name: 'massaGordura', label: 'Massa de Gordura', unit: 'kg' },
  { name: 'cintura', label: 'Cintura', unit: 'cm' },
  { name: 'imc', label: 'IMC' },
  { name: 'pgc', label: 'PGC', unit: '%' },
  { name: 'aguaCorporal', label: 'Água Corporal', unit: 'L' },
  { name: 'gorduraVisceral', label: 'Gordura Visceral' },
  { name: 'tmb', label: 'TMB', unit: 'kcal' },
];
const LAB_FIELDS: MeasurementField[] = [
  { name: 'ldl', label: 'LDL', unit: 'mg/dL' },
  { name: 'hba1c', label: 'HbA1C', unit: '%' },
  { name: 'insulina', label: 'Insulina', unit: 'µU/mL' },
];

const INPUT =
  'w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * Importação de laudo (E11/11.10): upload → extração (rascunho) → confirmação.
 * A extração NUNCA salva; o `<MeasurementForm>` pré-preenchido É o gate humano
 * obrigatório (ADR-012) — o médico revisa/corrige e só então grava.
 */
export function ImportLaudoPanel({ patientId, today }: { patientId: string; today: string }) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(extractLaudoAction, {});
  const draft = state.draft;
  const fields = (draft?.kind ?? 'body') === 'lab' ? LAB_FIELDS : BODY_FIELDS;

  return (
    <div className="space-y-6">
      {/* Passo 1 — upload */}
      <form action={formAction} className="card-premium gold-hairline p-5 space-y-4">
        <input type="hidden" name="patientId" value={patientId} />
        <div className="space-y-1.5">
          <label htmlFor="kind" className="text-sm font-medium text-ink">
            Tipo de laudo
          </label>
          <select id="kind" name="kind" defaultValue="body" className={INPUT}>
            <option value="body">Bioimpedância (composição corporal)</option>
            <option value="lab">Exames laboratoriais</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="file" className="text-sm font-medium text-ink">
            Arquivo PDF
          </label>
          <input id="file" name="file" type="file" accept="application/pdf" required className={INPUT} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Lendo o laudo…' : 'Enviar e extrair'}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>

      {/* Passo 2 — confirmação (gate humano obrigatório, ADR-012) */}
      {draft && (
        <div>
          <div className="rounded-[10px] border border-amber-300/50 bg-amber-400/10 p-4 text-sm text-amber-800">
            <strong>Valores extraídos por IA — confira antes de salvar.</strong> A IA assiste; a
            decisão é sua. Corrija o que for necessário; nada é gravado sem a sua confirmação.
            {state.message ? ` ${state.message}` : ''}
          </div>
          <MeasurementForm
            patientId={patientId}
            kind={draft.kind}
            fields={fields}
            defaultDate={draft.measuredAt ?? today}
            defaults={draft.values}
            modelVersion={state.modelVersion}
            title="Confirmar valores extraídos"
          />
        </div>
      )}
    </div>
  );
}
