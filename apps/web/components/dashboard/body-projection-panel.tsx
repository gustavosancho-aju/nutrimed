'use client';

import { useActionState, useRef, useState } from 'react';
import { generateBodyProjectionAction, type ProjectionState } from '@/lib/body-projection-actions';
import { downscaleImage } from '@/lib/image-downscale';

const INPUT =
  'w-full rounded-[10px] border border-ink/15 bg-surface-raised px-3.5 py-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

/**
 * Passo 1 da projeção corporal: foto + pesos → imagem gerada por IA.
 *
 * A imagem gerada NÃO aparece aqui: ela entra na lista abaixo como pendente, e
 * é lá que o médico aprova ou descarta (gate humano). Mostrar nos dois lugares
 * duplicaria a decisão e deixaria dúvida sobre qual botão vale.
 */
export function BodyProjectionPanel({
  patientId,
  pesoAtual,
  pesoMeta,
}: {
  patientId: string;
  pesoAtual?: number;
  pesoMeta?: number;
}) {
  const [state, formAction, pending] = useActionState<ProjectionState, FormData>(
    generateBodyProjectionAction,
    {},
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  /**
   * Reduz a foto assim que é escolhida e troca o arquivo do próprio input —
   * assim o `<form action>` continua sendo um envio comum, sem serializar a
   * imagem à mão.
   */
  async function handleFile() {
    const input = fileRef.current;
    const file = input?.files?.[0];
    if (!input || !file) {
      setPreview(null);
      return;
    }
    setPreview(URL.createObjectURL(file));
    const reduzida = await downscaleImage(file);
    if (reduzida !== file) {
      const dt = new DataTransfer();
      dt.items.add(reduzida);
      input.files = dt.files;
    }
  }

  return (
    <form action={formAction} className="card-premium gold-hairline space-y-4 p-5">
      <input type="hidden" name="patientId" value={patientId} />

      <div className="space-y-1.5">
        <label htmlFor="file" className="text-sm font-medium text-ink">
          Foto do paciente
        </label>
        <input
          ref={fileRef}
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={handleFile}
          className={INPUT}
        />
        <p className="text-xs text-ink-muted">
          De corpo inteiro, de frente, com roupa justa ou neutra e fundo simples — é o que dá a
          projeção mais fiel. A foto é reduzida no seu navegador antes do envio.
        </p>
      </div>

      {preview && (
        // <img> e não next/image: a origem é um blob: local, que o otimizador não processa.
        <img src={preview} alt="Pré-visualização da foto escolhida" className="max-h-64 rounded-[10px]" />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="sourceWeightKg" className="text-sm font-medium text-ink">
            Peso atual (kg)
          </label>
          <input
            id="sourceWeightKg"
            name="sourceWeightKg"
            type="number"
            step="0.1"
            inputMode="decimal"
            defaultValue={pesoAtual ?? ''}
            required
            className={INPUT}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="targetWeightKg" className="text-sm font-medium text-ink">
            Peso desejado (kg)
          </label>
          <input
            id="targetWeightKg"
            name="targetWeightKg"
            type="number"
            step="0.1"
            inputMode="decimal"
            defaultValue={pesoMeta ?? ''}
            required
            className={INPUT}
          />
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
        <span>
          O paciente autorizou o uso da sua foto para esta simulação. A foto e a imagem gerada ficam
          criptografadas e visíveis apenas para você.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Gerando a projeção…' : 'Gerar projeção'}
      </button>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.projectionId && !state.error && (
        <p className="text-sm text-ink-muted">{state.message}</p>
      )}
    </form>
  );
}
