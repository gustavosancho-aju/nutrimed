// (b) Mapeamento recordatório → TACO + (c) cálculo determinístico de nutrientes.
// SEM LLM: busca lexical top-1 com threshold — barato, determinístico e auditável.
// Todo valor sai de `per100g * grams / 100`; a IA nunca toca nos números.
import {
  TACO_MATCH_THRESHOLD,
  defaultPortionGrams,
  gramsForQuantity,
  searchFood,
} from '@nutrimed/taco';
import type { RecallItem } from './extract';

export type MappedStatus = 'matched' | 'uncertain' | 'unmatched';

export interface MappedItem {
  readonly item: RecallItem;
  readonly status: MappedStatus;
  /** Item TACO escolhido (ausente quando unmatched). score < threshold ⇒ uncertain. */
  readonly taco?: { readonly id: string; readonly description: string; readonly score: number };
  /** Gramas considerados no cálculo (null quando unmatched). */
  readonly grams: number | null;
  /** true quando a porção foi ASSUMIDA (paciente não quantificou ou unidade desconhecida). */
  readonly gramsEstimated: boolean;
  /** Rótulo da porção assumida, ex.: "1 concha média (100 g)". */
  readonly portionLabel?: string;
  /** Nutrientes calculados para a porção (null quando unmatched). */
  readonly nutrients: Readonly<Record<string, number>> | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function mapRecallToTaco(items: readonly RecallItem[]): MappedItem[] {
  return items.map((item) => {
    const [match] = searchFood(item.food, 1);
    if (!match) {
      return { item, status: 'unmatched' as const, grams: null, gramsEstimated: false, nutrients: null };
    }
    const { food, score } = match;
    const status: MappedStatus = score >= TACO_MATCH_THRESHOLD ? 'matched' : 'uncertain';

    let grams: number | null = null;
    let gramsEstimated = false;
    let portionLabel: string | undefined;

    if (item.quantity !== undefined && item.unit !== undefined) {
      grams = gramsForQuantity(food, item.quantity, item.unit);
      if (grams === null) {
        // unidade desconhecida ⇒ cai na porção padrão, SINALIZADA
        const portion = defaultPortionGrams(food);
        grams = portion.grams;
        gramsEstimated = true;
        portionLabel = portion.label;
      }
    } else if (item.quantity !== undefined) {
      // "2 bananas" sem unidade: quantidade × porção unitária padrão, sinalizada
      const portion = defaultPortionGrams(food);
      grams = item.quantity * portion.grams;
      gramsEstimated = true;
      portionLabel = `${item.quantity} × ${portion.label}`;
    } else {
      // paciente não quantificou ⇒ porção padrão, sinalizada como estimativa
      const portion = defaultPortionGrams(food);
      grams = portion.grams;
      gramsEstimated = true;
      portionLabel = portion.label;
    }

    const nutrients: Record<string, number> = {};
    for (const [name, per100] of Object.entries(food.per100g)) {
      nutrients[name] = round1((per100 * grams) / 100);
    }

    return {
      item,
      status,
      taco: { id: food.id, description: food.description, score },
      grams: Math.round(grams),
      gramsEstimated,
      ...(portionLabel !== undefined ? { portionLabel } : {}),
      nutrients,
    };
  });
}
