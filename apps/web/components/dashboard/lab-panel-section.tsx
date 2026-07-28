'use client';

import { Fragment, useMemo, useState } from 'react';
import { LAB_CATEGORY_LABEL, REFERENCE_STATUS_LABEL, type ReferenceStatus } from '@nutrimed/lab-catalog';
import { rangeLabel, type AnalyteSeries } from '@/lib/lab-panel';
import { setLabDisplayAction } from '@/lib/lab-panel-actions';
import { AnalyteCard } from './analyte-card';

/**
 * Painel laboratorial da dashboard (E14, revisto em 2026-07-28).
 *
 * A primeira versão desenhava um gráfico para CADA exame — com um laudo real de
 * 69 analitos isso vira uma parede de 69 gráficos, em que nada se destaca e o
 * médico rola a página para achar um valor. Invertido: a LISTA é a visão padrão
 * (uma linha por exame, tudo numa tela), e o médico marca o que quer ver como
 * gráfico.
 *
 * A marcação é instantânea — o gráfico aparece sem salvar, porque durante a
 * consulta o médico está explorando. Salvar serve para (a) reencontrar a mesma
 * seleção na próxima consulta e (b) definir o que o paciente vê no Modo
 * Apresentação. São a MESMA seleção de propósito: manter duas listas separadas
 * dobraria o trabalho do médico para uma distinção que ele não pediu.
 */

const STATUS_DOT: Record<ReferenceStatus, string> = {
  dentro: 'bg-emerald-500',
  fora: 'bg-amber-500',
  'sem-referencia': 'bg-ink/25',
};

const STATUS_TEXTO: Record<ReferenceStatus, string> = {
  dentro: 'text-emerald-700',
  fora: 'text-amber-700',
  'sem-referencia': 'text-ink-muted',
};

/** Rótulo curto — a coluna é estreita; o texto completo vai no title. */
const STATUS_CURTO: Record<ReferenceStatus, string> = {
  dentro: 'dentro',
  fora: 'fora',
  'sem-referencia': '—',
};

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Normaliza para busca (sem acento, minúsculo). */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function LabPanelSection({
  patientId,
  series,
  presentedIniciais,
  max,
}: {
  patientId: string;
  series: readonly AnalyteSeries[];
  presentedIniciais: readonly string[];
  max: number;
}) {
  const existentes = useMemo(() => new Set(series.map((s) => s.slug)), [series]);
  const [selecionados, setSelecionados] = useState<readonly string[]>(() =>
    presentedIniciais.filter((s) => existentes.has(s)),
  );
  const [busca, setBusca] = useState('');
  const [salvo, setSalvo] = useState<readonly string[]>(() =>
    presentedIniciais.filter((s) => existentes.has(s)),
  );

  const porSlug = useMemo(() => new Map(series.map((s) => [s.slug, s])), [series]);
  const cheio = selecionados.length >= max;

  // Alteração pendente = o que está na tela difere do que foi salvo.
  const pendente =
    salvo.length !== selecionados.length || salvo.some((s, i) => s !== selecionados[i]);

  const alternar = (slug: string) =>
    setSelecionados((atual) => {
      if (atual.includes(slug)) return atual.filter((s) => s !== slug);
      if (atual.length >= max) return atual;
      return [...atual, slug]; // entra no fim: a ordem é a de escolha
    });

  const mover = (indice: number, delta: number) =>
    setSelecionados((atual) => {
      const destino = indice + delta;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      const [item] = copia.splice(indice, 1);
      copia.splice(destino, 0, item!);
      return copia;
    });

  const filtradas = useMemo(() => {
    const termo = fold(busca.trim());
    if (!termo) return series;
    return series.filter((s) => fold(s.label).includes(termo) || fold(s.slug).includes(termo));
  }, [series, busca]);

  // Agrupa preservando a ordem clínica já calculada no servidor.
  const grupos = useMemo(() => {
    const out: { categoria: string; itens: AnalyteSeries[] }[] = [];
    for (const s of filtradas) {
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.categoria === s.category) ultimo.itens.push(s);
      else out.push({ categoria: s.category, itens: [s] });
    }
    return out;
  }, [filtradas]);

  const foraDaReferencia = series.filter((s) => s.status === 'fora').length;

  return (
    <div>
      {/* ── Gráficos dos exames marcados ────────────────────────────────── */}
      {selecionados.length > 0 && (
        <section className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-ink">
              Gráficos
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {selecionados.length} de {max}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => setSelecionados([])}
              className="text-xs text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              limpar seleção
            </button>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {selecionados.map((slug, i) => {
              const s = porSlug.get(slug);
              if (!s) return null;
              return (
                <AnalyteCard
                  key={slug}
                  series={s}
                  /* Ordem dos gráficos = ordem da Apresentação. */
                  actions={
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => mover(i, -1)}
                        disabled={i === 0}
                        aria-label={`Mover ${s.label} para antes`}
                        className="rounded-[6px] border border-ink/15 px-1.5 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-30"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => mover(i, 1)}
                        disabled={i === selecionados.length - 1}
                        aria-label={`Mover ${s.label} para depois`}
                        className="rounded-[6px] border border-ink/15 px-1.5 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-30"
                      >
                        →
                      </button>
                      <button
                        type="button"
                        onClick={() => alternar(slug)}
                        aria-label={`Tirar ${s.label} dos gráficos`}
                        className="rounded-[6px] border border-ink/15 px-1.5 text-xs text-ink transition-colors hover:bg-surface-muted"
                      >
                        ✕
                      </button>
                    </span>
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {/* ── Lista de todos os exames ────────────────────────────────────── */}
      <section className="card-premium gold-hairline p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">Exames do paciente</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {series.length} {series.length === 1 ? 'exame' : 'exames'}
              {foraDaReferencia > 0 && ` · ${foraDaReferencia} fora da referência do laudo`}
              {' · marque para ver o gráfico'}
            </p>
          </div>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar exame…"
            aria-label="Buscar exame"
            className="w-56 rounded-[10px] border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>

        {cheio && (
          <p className="mt-3 rounded-[8px] border border-amber-300/50 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-800">
            Limite de {max} gráficos — desmarque um para incluir outro.
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="w-10 py-2 pr-2">
                  <span className="sr-only">Ver gráfico</span>
                </th>
                <th className="py-2 pr-3 font-medium">Exame</th>
                <th className="py-2 pr-3 text-right font-medium">Resultado</th>
                <th className="py-2 pr-3 font-medium">Referência do laudo</th>
                <th className="py-2 pr-3 font-medium">Situação</th>
                <th className="py-2 pr-3 text-right font-medium">Medições</th>
                <th className="py-2 text-right font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <Fragment key={g.categoria}>
                  <tr className="border-b border-ink/5">
                    <td colSpan={7} className="pb-1 pt-4 text-[11px] uppercase tracking-wide text-ink-muted">
                      {LAB_CATEGORY_LABEL[g.categoria as keyof typeof LAB_CATEGORY_LABEL] ?? g.categoria}
                    </td>
                  </tr>
                  {g.itens.map((s) => {
                    const marcado = selecionados.includes(s.slug);
                    const faixa = rangeLabel(s);
                    return (
                      <tr
                        key={s.slug}
                        className={`border-b border-ink/5 last:border-0 ${marcado ? 'bg-brand/[0.04]' : ''}`}
                      >
                        <td className="py-1.5 pr-2">
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={!marcado && cheio}
                            onChange={() => alternar(s.slug)}
                            aria-label={`Ver gráfico de ${s.label}`}
                            className="h-4 w-4 accent-brand disabled:opacity-40"
                          />
                        </td>
                        <td className="py-1.5 pr-3">
                          <label className="cursor-pointer text-ink" onClick={() => !(!marcado && cheio) && alternar(s.slug)}>
                            {s.label}
                          </label>
                        </td>
                        <td className="py-1.5 pr-3 text-right font-medium tabular-nums text-ink">
                          {fmt(s.latest)}
                          {s.unit && <span className="ml-1 text-[11px] font-normal text-ink-muted">{s.unit}</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">{faixa ?? '—'}</td>
                        <td className={`py-1.5 pr-3 ${STATUS_TEXTO[s.status]}`}>
                          <span
                            className="inline-flex items-center gap-1.5"
                            title={REFERENCE_STATUS_LABEL[s.status]}
                          >
                            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status]}`} />
                            {STATUS_CURTO[s.status]}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">
                          {s.points.length}
                        </td>
                        <td className="py-1.5 text-right text-ink-muted">
                          {DATE_FMT.format(s.latestAt)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
          {filtradas.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-muted">
              Nenhum exame encontrado para “{busca}”.
            </p>
          )}
        </div>

        {/* Salvar: persiste a seleção e a ORDEM para a próxima consulta e para o
            Modo Apresentação. Os gráficos acima já respondem sem salvar. */}
        <form action={setLabDisplayAction} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="patientId" value={patientId} />
          {selecionados.map((slug) => (
            <input key={slug} type="hidden" name="apresentar" value={slug} />
          ))}
          <button
            type="submit"
            disabled={!pendente}
            onClick={() => setSalvo(selecionados)}
            className="rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Salvar seleção
          </button>
          <span className="text-[11px] text-ink-muted">
            {pendente
              ? 'Alterações não salvas — salvar define o que o paciente vê no Modo Apresentação.'
              : 'Seleção salva — é o que aparece no Modo Apresentação, nesta ordem.'}
          </span>
        </form>
      </section>

      <p className="mt-4 text-xs text-ink-muted">
        As faixas exibidas são as que o próprio laboratório imprimiu no laudo — apoio visual, não
        diagnóstico. A interpretação é do médico responsável.
      </p>
    </div>
  );
}
