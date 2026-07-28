import type { BodyProjectionRecord, StoredImage } from '@nutrimed/patients';
import {
  approveBodyProjectionAction,
  deleteBodyProjectionAction,
} from '@/lib/body-projection-actions';

/**
 * Projeções salvas do paciente — onde o GATE HUMANO acontece: enquanto o médico
 * não aprovar, a imagem não existe para o paciente (não aparece no Modo
 * Apresentação). Server Component: as imagens vão como data URL dentro do HTML
 * já autenticado, nunca por URL própria (foto de paciente é dado sensível).
 */
export function BodyProjectionList({
  patientId,
  photo,
  projections,
}: {
  patientId: string;
  photo: StoredImage | null;
  projections: BodyProjectionRecord[];
}) {
  if (projections.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nenhuma projeção ainda. Envie uma foto acima para gerar a primeira.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {projections.map((p) => (
        <li key={p.id} className="card-premium gold-hairline space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink">
                {p.sourceWeightKg.toFixed(1)} kg → {p.targetWeightKg.toFixed(1)} kg
              </p>
              <p className="text-xs text-ink-muted">
                {p.createdAt.toLocaleDateString('pt-BR')} · {p.modelVersion}
              </p>
            </div>
            {p.approvedAt ? (
              <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                ✓ Aprovada para a apresentação
              </span>
            ) : (
              <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-800">
                Pendente da sua revisão
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {photo && (
              <figure className="space-y-1.5">
                {/* <img> e não next/image: a imagem é uma data URL (cifrada em repouso,
                    sem URL própria) — não há o que o otimizador busque. */}
                <img
                  src={`data:${photo.mimeType};base64,${photo.base64}`}
                  alt="Foto atual do paciente"
                  className="w-full rounded-[10px]"
                />
                <figcaption className="text-xs text-ink-muted">
                  Hoje — {p.sourceWeightKg.toFixed(1)} kg
                </figcaption>
              </figure>
            )}
            <figure className="space-y-1.5">
              {/* data URL, mesmo caso do <img> acima. */}
              <img
                src={`data:${p.image.mimeType};base64,${p.image.base64}`}
                alt={`Projeção do paciente com ${p.targetWeightKg.toFixed(1)} kg`}
                className="w-full rounded-[10px]"
              />
              <figcaption className="text-xs text-ink-muted">
                Projeção — {p.targetWeightKg.toFixed(1)} kg
              </figcaption>
            </figure>
          </div>

          <div className="flex flex-wrap gap-2">
            {!p.approvedAt && (
              <form action={approveBodyProjectionAction}>
                <input type="hidden" name="patientId" value={patientId} />
                <input type="hidden" name="projectionId" value={p.id} />
                <button
                  type="submit"
                  className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Aprovar para a apresentação
                </button>
              </form>
            )}
            <form action={deleteBodyProjectionAction}>
              <input type="hidden" name="patientId" value={patientId} />
              <input type="hidden" name="projectionId" value={p.id} />
              <button
                type="submit"
                className="rounded-[10px] border border-ink/15 px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-muted"
              >
                Descartar
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
