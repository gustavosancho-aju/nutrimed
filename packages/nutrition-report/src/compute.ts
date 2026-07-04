// (c) Totais e comparação com a meta vigente do paciente — código puro.
import { TACO_VERSION } from '@nutrimed/taco';
import type { NutritionGoalValues } from '@nutrimed/patients';
import type { RecallItem } from './extract';
import type { MappedItem } from './map';

/** Nutrientes somados nos totais do relatório (os demais ficam por item). */
export const TOTAL_NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const;

export interface NutritionComputation {
  readonly items: readonly MappedItem[];
  /** Somatório dos itens com match (matched + uncertain). */
  readonly totals: Readonly<Record<string, number>>;
  /** Itens sem correspondência na TACO — SINALIZADOS, nunca silenciados. */
  readonly unmatched: readonly RecallItem[];
  /** Quantos itens tiveram porção assumida (não dita pelo paciente). */
  readonly estimatedCount: number;
  readonly goal?: NutritionGoalValues;
  /** totals − goal para kcal/protein/carbs/fat (positivo = acima da meta). */
  readonly goalDelta?: Readonly<Record<string, number>>;
  readonly tacoVersion: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeNutrition(
  mapped: readonly MappedItem[],
  goal?: NutritionGoalValues,
): NutritionComputation {
  const totals: Record<string, number> = {};
  for (const name of TOTAL_NUTRIENTS) totals[name] = 0;
  for (const entry of mapped) {
    if (!entry.nutrients) continue;
    for (const name of TOTAL_NUTRIENTS) {
      totals[name] = round1((totals[name] ?? 0) + (entry.nutrients[name] ?? 0));
    }
  }

  const unmatched = mapped.filter((m) => m.status === 'unmatched').map((m) => m.item);
  const estimatedCount = mapped.filter((m) => m.gramsEstimated).length;

  let goalDelta: Record<string, number> | undefined;
  if (goal) {
    goalDelta = {
      kcal: round1((totals.kcal ?? 0) - goal.kcal),
      protein: round1((totals.protein ?? 0) - goal.protein),
      carbs: round1((totals.carbs ?? 0) - goal.carbs),
      fat: round1((totals.fat ?? 0) - goal.fat),
    };
  }

  return {
    items: mapped,
    totals,
    unmatched,
    estimatedCount,
    ...(goal !== undefined ? { goal } : {}),
    ...(goalDelta !== undefined ? { goalDelta } : {}),
    tacoVersion: TACO_VERSION,
  };
}
