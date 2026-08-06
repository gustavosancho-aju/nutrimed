/**
 * @nutrimed/food-catalog (E16) — vocabulário canônico de alimentos.
 *
 * Existe porque a busca lexical sobre a TACO escolhia o alimento errado de forma
 * sistemática ("frango grelhado" → coração de galinha; "arroz branco" → arroz
 * carreteiro), e porque a TACO, sendo de 2011 e acadêmica, não tem suplemento
 * nenhum.
 *
 * Duas responsabilidades, ambas PURAS (sem banco, sem rede, sem IA):
 *  1. Dizer qual é o item canônico para o termo que o paciente digitou
 *     ({@link resolveFood}) — catálogo curado primeiro, busca lexical depois.
 *  2. Fornecer os alimentos que a TACO não tem ({@link EXTRA_FOODS}), só de
 *     fontes com licença compatível (USDA CC0 e rótulo ANVISA).
 *
 * O pacote NÃO calcula nutriente de porção (isso é do `@nutrimed/nutrition-report`)
 * e NÃO decide nada clínico.
 */
export {
  FOOD_CATALOG,
  BLOCKED_TERMS,
  blockedTerm,
  catalogSize,
  lookupAlias,
  normalizeTerm,
  type FoodAlias,
  type FoodRef,
} from './catalog';

export {
  AMBIGUOUS_FOODS,
  EXTRA_FOODS,
  EXTRA_FOODS_VERSION,
  getExtraFood,
  type ExtraFood,
  type ExtraFoodSource,
} from './extra-foods';

export {
  FOOD_TABLES_VERSION,
  foodCandidates,
  resolveFood,
  type FoodResolution,
  type ResolvedFood,
  type ResolutionVia,
  type UnresolvedFood,
} from './resolve';
