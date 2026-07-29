import type { BodyProjectionRecord, StoredImage } from '@nutrimed/patients';
import {
  approveBodyProjectionAction,
  deleteBodyProjectionAction,
} from '@/lib/body-projection-actions';

/**
 * Depois disto, uma projeção ainda 'processing' está travada — o processo do
 * servidor caiu ou reiniciou no meio da geração (que leva ~2,5 min). Sem esse
 * corte o médico ficaria olhando "gerando…" para sempre.
 */
const LIMITE_PROCESSANDO_MS = 15 * 60_000;

export function travada(p: BodyProjectionRecord): boolean {
  return p.status === 'processing' && Date.now() - p.createdAt.getTime() > LIMITE_PROCESSANDO_MS;
}

function StatusBadge({ projection: p }: { projection: BodyProjectionRecord }) {
  const [texto, classe] =
    p.status === 'processing'
      ? travada(p)
        ? ['Travada', 'bg-red-500/10 text-red-700']
        : ['Gerando…', 'bg-ink/10 text-ink-muted']
      : p.status === 'failed'
        ? ['Falhou', 'bg-red-500/10 text-red-700']
        : p.approvedAt
          ? ['✓ Aprovada para a apresentação', 'bg-brand/10 text-brand']
          : ['Pendente da sua revisão', 'bg-amber-400/15 text-amber-800'];

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${classe}`}>{texto}</span>;
}

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
            <StatusBadge projection={p} />
          </div>

          {p.status === 'processing' && (
            <p className="text-sm text-ink-muted">
              {travada(p)
                ? 'A geração não respondeu a tempo. Descarte esta e tente novamente.'
                : 'Gerando a imagem… leva alguns minutos. Pode sair desta tela: o resultado fica salvo aqui.'}
            </p>
          )}
          {p.status === 'failed' && (
            <p className="text-sm text-red-600">{p.errorMessage ?? 'Falha ao gerar a projeção.'}</p>
          )}

          {p.image && (
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
          )}

          <div className="flex flex-wrap gap-2">
            {p.status === 'ready' && !p.approvedAt && (
              <form action={approveBodyProjectionAction}>
                <input type="hidden" name="patientId" value={patientId} />
                <input type="hidden" name="projectionId" value={p.id} />
                <button
                  type="submit"
                  className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition-opacity hover:opacity-90"
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
