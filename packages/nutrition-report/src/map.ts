// (b) Mapeamento recordatório → alimento canônico + (c) cálculo determinístico
// de nutrientes. SEM LLM: todo valor sai de `per100g * grams / 100`; a IA nunca
// toca nos números.
//
// A escolha do alimento passou a ser do `@nutrimed/food-catalog` (E16), que tenta
// o catálogo curado antes da busca lexical. Antes disto, a busca sozinha errava de
// forma sistemática — "frango grelhado" virava coração de galinha (proteína −30%,
// gordura +385%) e "arroz branco" virava arroz carreteiro (proteína 4,3×) — porque
// similaridade de string não sabe qual alimento as pessoas comem.
import { defaultPortionGrams, gramsForQuantity } from '@nutrimed/taco';
import { resolveFood, type ResolvedFood } from '@nutrimed/food-catalog';
import type { RecallItem } from './extract';

export type MappedStatus = 'matched' | 'uncertain' | 'unmatched';

export interface MappedItem {
  readonly item: RecallItem;
  readonly status: MappedStatus;
  /**
   * Alimento escolhido (ausente quando unmatched). `source` diz de qual tabela
   * veio o número — TACO ou tabela própria do NutriMed — e é isso que a trilha
   * de auditoria registra. Score abaixo do limiar ⇒ `uncertain`.
   */
  readonly taco?: {
    readonly id: string;
    readonly description: string;
    readonly score: number;
    readonly source: 'taco' | 'nutrimed';
  };
  /** Gramas considerados no cálculo (null quando unmatched). */
  readonly grams: number | null;
  /** true quando a porção foi ASSUMIDA (paciente não quantificou ou unidade desconhecida). */
  readonly gramsEstimated: boolean;
  /** Rótulo da porção assumida, ex.: "1 concha média (100 g)". */
  readonly portionLabel?: string;
  /** Nutrientes calculados para a porção (null quando unmatched). */
  readonly nutrients: Readonly<Record<string, number>> | null;
  /**
   * Por que o item não entrou na conta, em pt-BR e pronto para mostrar ao
   * paciente. Só existe quando `status === 'unmatched'`. Distingue "não conheço
   * esse alimento" de "conheço, mas não tenho valor confiável" (leite líquido,
   * que a TACO só tem em pó) e de "é ambíguo demais" (barra de proteína, cuja
   * faixa real vai de 294 a 504 kcal/100 g).
   */
  readonly missReason?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function unmatchedItem(item: RecallItem, missReason?: string): MappedItem {
  return {
    item,
    status: 'unmatched',
    grams: null,
    gramsEstimated: false,
    nutrients: null,
    ...(missReason !== undefined ? { missReason } : {}),
  };
}

/** Gramas da porção + se foi assumida. Separado para manter `mapRecallToTaco` legível. */
function resolvePortion(
  food: ResolvedFood,
  item: RecallItem,
): { grams: number; estimated: boolean; label?: string } {
  if (item.quantity !== undefined && item.unit !== undefined) {
    const grams = gramsForQuantity(food, item.quantity, item.unit);
    if (grams !== null) return { grams, estimated: false };
    // unidade desconhecida ⇒ cai na porção padrão, SINALIZADA
    const portion = defaultPortionGrams(food);
    return { grams: portion.grams, estimated: true, label: portion.label };
  }
  if (item.quantity !== undefined) {
    // "2 bananas" sem unidade: quantidade × porção unitária padrão, sinalizada
    const portion = defaultPortionGrams(food);
    return { grams: item.quantity * portion.grams, estimated: true, label: `${item.quantity} × ${portion.label}` };
  }
  // paciente não quantificou ⇒ porção padrão, sinalizada como estimativa
  const portion = defaultPortionGrams(food);
  return { grams: portion.grams, estimated: true, label: portion.label };
}

export function mapRecallToTaco(items: readonly RecallItem[]): MappedItem[] {
  return items.map((item) => {
    const resolution = resolveFood(item.food);
    if (!resolution.ok) return unmatchedItem(item, resolution.miss.message);

    const food = resolution.food;
    const { grams, estimated, label } = resolvePortion(food, item);

    const nutrients: Record<string, number> = {};
    for (const [name, per100] of Object.entries(food.per100g)) {
      nutrients[name] = round1((per100 * grams) / 100);
    }

    return {
      item,
      status: food.confident ? ('matched' as const) : ('uncertain' as const),
      taco: { id: food.id, description: food.description, score: food.score, source: food.source },
      grams: Math.round(grams),
      gramsEstimated: estimated,
      ...(label !== undefined ? { portionLabel: label } : {}),
      nutrients,
    };
  });
}
