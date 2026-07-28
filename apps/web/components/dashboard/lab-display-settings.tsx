'use client';

import { useState } from 'react';
import { LAB_CATEGORY_LABEL } from '@nutrimed/lab-catalog';
import { setLabDisplayAction } from '@/lib/lab-panel-actions';

/**
 * Seleção dos exames que vão para a tela de APRESENTAÇÃO do paciente (E14).
 *
 * A ordem importa e é do médico: ele monta a narrativa da consulta ("olha o
 * triglicérides primeiro, depois o LDL"). Por isso a seleção não é uma lista de
 * checkboxes solta — os escolhidos viram uma fila reordenável, e é essa ordem
 * que a apresentação obedece.
 *
 * Só a SELEÇÃO é salva aqui; os valores já estão no histórico. Desmarcar um
 * exame nunca apaga dado — só tira da tela do paciente.
 */

/** O mínimo que este componente precisa saber de uma série. */
export interface OpcaoExame {
  readonly slug: string;
  readonly label: string;
  readonly category: string;
  readonly pontos: number;
}

export function LabDisplaySettings({
  patientId,
  opcoes,
  selecionadosIniciais,
  max,
}: {
  patientId: string;
  opcoes: readonly OpcaoExame[];
  selecionadosIniciais: readonly string[];
  max: number;
}) {
  // Só slugs que ainda existem — um exame removido não deve ocupar vaga.
  const validos = new Set(opcoes.map((o) => o.slug));
  const [selecionados, setSelecionados] = useState<readonly string[]>(() =>
    selecionadosIniciais.filter((s) => validos.has(s)),
  );

  const porSlug = new Map(opcoes.map((o) => [o.slug, o]));
  const cheio = selecionados.length >= max;

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

  // Agrupa as opções por categoria preservando a ordem já calculada no servidor.
  const grupos: { categoria: string; itens: OpcaoExame[] }[] = [];
  for (const o of opcoes) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.categoria === o.category) ultimo.itens.push(o);
    else grupos.push({ categoria: o.category, itens: [o] });
  }

  return (
    <details className="card-premium gold-hairline mt-6 p-5" open={selecionados.length === 0}>
      <summary className="cursor-pointer text-sm font-medium text-ink">
        Exames a apresentar ao paciente
        <span className="ml-2 text-xs font-normal text-ink-muted">
          {selecionados.length} de {max}
        </span>
      </summary>

      <form action={setLabDisplayAction} className="mt-3">
        <input type="hidden" name="patientId" value={patientId} />
        {selecionados.map((slug) => (
          <input key={slug} type="hidden" name="apresentar" value={slug} />
        ))}

        <p className="text-xs text-ink-muted">
          Marque os exames que devem aparecer no Modo Apresentação, na ordem em que você quer
          mostrá-los. Desmarcar não apaga nada do histórico.
        </p>

        {/* Fila escolhida — a ordem daqui é a ordem da apresentação */}
        {selecionados.length > 0 && (
          <ol className="mt-3 space-y-1.5">
            {selecionados.map((slug, i) => (
              <li
                key={slug}
                className="flex items-center gap-2 rounded-[10px] border border-ink/10 bg-surface px-3 py-2"
              >
                <span className="w-5 text-xs text-ink-muted">{i + 1}.</span>
                <span className="flex-1 text-sm text-ink">{porSlug.get(slug)?.label ?? slug}</span>
                <button
                  type="button"
                  onClick={() => mover(i, -1)}
                  disabled={i === 0}
                  aria-label={`Subir ${porSlug.get(slug)?.label ?? slug}`}
                  className="rounded-[6px] border border-ink/15 px-2 py-0.5 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-35"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => mover(i, 1)}
                  disabled={i === selecionados.length - 1}
                  aria-label={`Descer ${porSlug.get(slug)?.label ?? slug}`}
                  className="rounded-[6px] border border-ink/15 px-2 py-0.5 text-xs text-ink transition-colors hover:bg-surface-muted disabled:opacity-35"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => alternar(slug)}
                  aria-label={`Remover ${porSlug.get(slug)?.label ?? slug}`}
                  className="rounded-[6px] border border-ink/15 px-2 py-0.5 text-xs text-ink transition-colors hover:bg-surface-muted"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}

        {/* Catálogo do paciente, por categoria */}
        <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {grupos.map((g) => (
            <div key={g.categoria}>
              <p className="text-[11px] uppercase tracking-wide text-ink-muted">
                {LAB_CATEGORY_LABEL[g.categoria as keyof typeof LAB_CATEGORY_LABEL] ?? g.categoria}
              </p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {g.itens.map((o) => {
                  const marcado = selecionados.includes(o.slug);
                  return (
                    <label
                      key={o.slug}
                      className={`flex items-center gap-2 rounded-[8px] px-2 py-1 text-sm ${
                        !marcado && cheio ? 'opacity-40' : 'cursor-pointer hover:bg-surface-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={marcado}
                        disabled={!marcado && cheio}
                        onChange={() => alternar(o.slug)}
                        className="h-4 w-4 accent-[color:var(--brand)]"
                      />
                      <span className="flex-1 truncate text-ink">{o.label}</span>
                      <span className="text-[10px] text-ink-muted">
                        {o.pontos} {o.pontos === 1 ? 'resultado' : 'resultados'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {cheio && (
          <p className="mt-2 text-[11px] text-amber-700">
            Limite de {max} exames na apresentação — remova um para incluir outro.
          </p>
        )}

        <button
          type="submit"
          className="mt-4 rounded-[10px] bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          Salvar seleção
        </button>
      </form>
    </details>
  );
}
