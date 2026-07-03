import {
  type IFoodEstimator,
  type FoodImageInput,
  type FoodEstimate,
  sanitizeFoodEstimate,
} from './estimator';

/**
 * Estimador determinístico (sem rede) — para testes e degradação graciosa:
 * permite exercitar o fluxo do bot localmente sem credencial nem custo de API.
 * Os valores são EXEMPLOS fixos — a `notes` deixa isso explícito, e a estimativa
 * é sempre aproximada (ADR-015).
 */
const SAMPLE = {
  values: { kcal: 620, protein: 42, carbs: 68, fat: 18 },
  confidence: 'medium',
  itemsLabel: 'arroz, feijão, frango grelhado, salada (exemplo)',
  notes: 'Estimativa de exemplo (estimador fake) — aproximada, não é medida clínica.',
};

/** Valores fixos usados quando o paciente descreve/corrige o prato (hint). */
const SAMPLE_WITH_HINT = {
  values: { kcal: 580, protein: 48, carbs: 60, fat: 16 },
  confidence: 'high',
  notes: 'Estimativa de exemplo ajustada pela descrição do paciente (estimador fake).',
};

export class FakeFoodEstimator implements IFoodEstimator {
  readonly modelVersion = 'fake-food-estimator';

  async estimate(_input: FoodImageInput, hint?: string): Promise<FoodEstimate> {
    const cleanHint = hint?.trim();
    if (cleanHint) {
      return sanitizeFoodEstimate({ ...SAMPLE_WITH_HINT, itemsLabel: `${cleanHint} (exemplo)` });
    }
    return sanitizeFoodEstimate(SAMPLE);
  }
}
