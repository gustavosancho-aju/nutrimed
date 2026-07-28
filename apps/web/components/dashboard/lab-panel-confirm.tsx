'use client';

import { useState } from 'react';
import { matchAnalyte, parseReferenceRange, formatRange } from '@nutrimed/lab-catalog';
import type { ExtractedPanel } from '@nutrimed/lab-import';
import { saveLabPanelAction } from '@/lib/lab-panel-actions';

/**
 * Confirmação do painel importado (E14) — o GATE HUMANO obrigatório da
 * extração por IA (ADR-012). Nada foi gravado até aqui: esta tabela mostra tudo
 * o que a IA leu, o médico corrige o que estiver errado, desmarca o que não
 * quer guardar e só então salva.
 *
 * Três sinalizações deliberadas em cada linha, porque um painel de 40 exames é
 * grande demais para o médico conferir contra o PDF item a item:
 * - o nome CRU do laudo, quando difere do rótulo canônico (mostra o que foi
 *   reconhecido como o quê);
 * - "novo" para exame fora do catálogo (entra mesmo assim, como exame livre);
 * - a faixa de referência interpretada, para o médico ver se a leitura bateu.
 */

const INPUT =
  'w-full rounded-[8px] border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

interface Linha {
  readonly indice: number;
  readonly rawName: string;
  readonly label: string;
  readonly novo: boolean;
  readonly value: number;
  readonly unit?: string;
  readonly refLabel: string | null;
  readonly refText?: string;
  readonly historico: number;
}

function montarLinhas(panel: ExtractedPanel): Linha[] {
  return panel.analytes.map((a, indice) => {
    const def = matchAnalyte(a.rawName);
    const range = parseReferenceRange(a.referenceText);
    const unit = a.unit ?? def?.unit;
    return {
      indice,
      rawName: a.rawName,
      label: def?.label ?? a.rawName,
      novo: def === undefined,
      value: a.value,
      ...(unit ? { unit } : {}),
      refLabel: formatRange(range, unit),
      ...(a.referenceText ? { refText: a.referenceText } : {}),
      historico: a.history?.length ?? 0,
    };
  });
}

export function LabPanelConfirm({
  patientId,
  panel,
  modelVersion,
  today,
}: {
  patientId: string;
  panel: ExtractedPanel;
  modelVersion?: string;
  today: string;
}) {
  const linhas = montarLinhas(panel);
  const [marcados, setMarcados] = useState<ReadonlySet<number>>(
    () => new Set(linhas.map((l) => l.indice)),
  );
  const comHistorico = linhas.filter((l) => l.historico > 0).length;

  const alternar = (indice: number) =>
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(indice)) proximo.delete(indice);
      else proximo.add(indice);
      return proximo;
    });

  const todosMarcados = marcados.size === linhas.length;

  return (
    <form action={saveLabPanelAction} className="card-premium gold-hairline p-5">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="panel" value={JSON.stringify(panel)} />
      {modelVersion && <input type="hidden" name="modelVersion" value={modelVersion} />}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Confirmar exames lidos</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {linhas.length} {linhas.length === 1 ? 'exame lido' : 'exames lidos'} · {marcados.size}{' '}
            selecionado{marcados.size === 1 ? '' : 's'} para salvar
          </p>
        </div>
        <label className="space-y-1">
          <span className="block text-xs text-ink-muted">Data da coleta</span>
          <input
            name="measuredAt"
            type="date"
            required
            defaultValue={panel.measuredAt ?? today}
            className={INPUT}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setMarcados(todosMarcados ? new Set() : new Set(linhas.map((l) => l.indice)))}
          className="rounded-[8px] border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
        >
          {todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
        </button>
        {comHistorico > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="importarHistorico" defaultChecked className="h-4 w-4 accent-brand" />
            Importar também os resultados anteriores impressos no laudo
            <span className="text-xs text-ink-muted">
              ({comHistorico} {comHistorico === 1 ? 'exame traz' : 'exames trazem'} histórico)
            </span>
          </label>
        )}
      </div>

      <div className="mt-4 max-h-[560px] overflow-y-auto rounded-[10px] border border-ink/10">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface-muted">
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-muted">
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Incluir</span>
              </th>
              <th className="px-3 py-2">Exame</th>
              <th className="w-32 px-3 py-2">Valor</th>
              <th className="w-24 px-3 py-2">Unidade</th>
              <th className="px-3 py-2">Referência do laudo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const incluido = marcados.has(l.indice);
              return (
                <tr
                  key={l.indice}
                  className={`border-t border-ink/10 ${incluido ? '' : 'opacity-45'}`}
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      name="incluir"
                      value={l.indice}
                      checked={incluido}
                      onChange={() => alternar(l.indice)}
                      aria-label={`Incluir ${l.label}`}
                      className="mt-1 h-4 w-4 accent-brand"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="font-medium text-ink">{l.label}</span>
                    {l.novo && (
                      <span className="ml-2 rounded-full border border-amber-300/60 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        novo
                      </span>
                    )}
                    {l.historico > 0 && (
                      <span className="ml-2 text-[10px] text-ink-muted">
                        +{l.historico} anterior{l.historico === 1 ? '' : 'es'}
                      </span>
                    )}
                    {l.label !== l.rawName && (
                      <span className="mt-0.5 block text-[11px] text-ink-muted">{l.rawName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      name={`valor.${l.indice}`}
                      type="text"
                      inputMode="decimal"
                      defaultValue={String(l.value)}
                      aria-label={`Valor de ${l.label}`}
                      className={INPUT}
                    />
                  </td>
                  <td className="px-3 py-2 align-top text-ink-muted">{l.unit ?? '—'}</td>
                  <td className="px-3 py-2 align-top">
                    {l.refLabel ? (
                      <span className="text-ink">{l.refLabel}</span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                    {l.refText && l.refText !== l.refLabel && (
                      <span className="mt-0.5 block text-[11px] text-ink-muted">{l.refText}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="submit"
        disabled={marcados.size === 0}
        className="mt-5 rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Salvar {marcados.size} {marcados.size === 1 ? 'exame' : 'exames'}
      </button>
      <p className="mt-2 text-[11px] text-ink-muted">
        Os valores vão para o histórico do paciente. A interpretação e a conduta são do médico.
      </p>
    </form>
  );
}
