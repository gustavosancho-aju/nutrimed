import { ClaudeFoodEstimator } from './claude-estimator';
import { FakeFoodEstimator } from './fake-estimator';
import type { IFoodEstimator } from './estimator';

export {
  type IFoodEstimator,
  type FoodImageInput,
  type FoodEstimate,
  type FoodConfidence,
  type Nutrient,
  KNOWN_NUTRIENTS,
  sanitizeFoodEstimate,
} from './estimator';
export {
  ClaudeFoodEstimator,
  FoodEstimatorError,
  type ClaudeFoodEstimatorConfig,
} from './claude-estimator';
export { FakeFoodEstimator } from './fake-estimator';

/**
 * Seleciona o estimador conforme o ambiente (degradação graciosa, espelha ADR-012):
 * - `FOOD_ESTIMATOR=fake` força o fake (testes/verificação local sem custo).
 * - `ANTHROPIC_API_KEY` presente ⇒ Claude (visão da foto).
 * - sem key fora de produção ⇒ fake (permite exercitar o fluxo localmente).
 * - produção sem key ⇒ `null` (o bot informa indisponibilidade, sem inventar).
 */
export function createFoodEstimator(
  env: NodeJS.ProcessEnv = process.env,
  opts: { onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void } = {},
): IFoodEstimator | null {
  if (env.FOOD_ESTIMATOR === 'fake') return new FakeFoodEstimator();
  if (env.ANTHROPIC_API_KEY) {
    return new ClaudeFoodEstimator({ apiKey: env.ANTHROPIC_API_KEY, onUsage: opts.onUsage });
  }
  if (env.NODE_ENV !== 'production') return new FakeFoodEstimator();
  return null;
}
