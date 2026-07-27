/**
 * @nutrimed/lab-catalog (E14) — vocabulário canônico de exames laboratoriais.
 *
 * Duas responsabilidades, ambas PURAS (sem banco, sem rede, sem IA):
 * 1. Canonicalizar o nome do exame, para que a série histórica não se
 *    fragmente quando o laboratório muda a grafia ({@link matchAnalyte}).
 * 2. Ler a faixa de referência que o laudo imprimiu ({@link parseReferenceRange}).
 *
 * O pacote NÃO decide nada clínico: não classifica risco, não sugere conduta e
 * não mantém faixas próprias.
 */
export {
  LAB_CATALOG,
  LAB_CATEGORY_LABEL,
  LAB_CATEGORY_ORDER,
  FREE_SLUG_PREFIX,
  analyteBySlug,
  categoryOf,
  findAnalyte,
  isFreeSlug,
  matchAnalyte,
  normalizeName,
  toFreeSlug,
  type LabAnalyteDef,
  type LabCategory,
} from './catalog';

export {
  REFERENCE_STATUS_LABEL,
  classifyAgainstReference,
  formatRange,
  parseNumber,
  parseReferenceRange,
  type ReferenceRange,
  type ReferenceStatus,
} from './reference';
