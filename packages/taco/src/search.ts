// Busca lexical determinística sobre a tabela TACO (4ª ed., NEPA/Unicamp).
// Mesma filosofia do RAG lexical do @nutrimed/kb: tokenização pt-BR normalizada
// (minúsculas, sem acentos, sem stopwords), sem embeddings — resultado auditável.
import dataset from './data/taco.json';

export interface TacoFood {
  readonly id: string;
  readonly description: string;
  readonly category: string;
  /** Nutrientes por 100 g de parte comestível (kcal; demais em g/mg conforme a TACO). */
  readonly per100g: Readonly<Record<string, number>>;
}

export interface TacoMatch {
  readonly food: TacoFood;
  /** 0..1 — fração ponderada de termos casados. Abaixo de TACO_MATCH_THRESHOLD, trate como incerto. */
  readonly score: number;
}

/** Versão do dataset embarcado (proveniência NFR10). */
export const TACO_VERSION: string = dataset.version;

/**
 * Score mínimo para considerar um match confiável; abaixo disso o item deve ser
 * sinalizado ao paciente.
 *
 * Era 0.5, e isso era um bug silencioso: "arroz branco" pontuava EXATAMENTE 0.5
 * contra "Arroz carreteiro" e, como a comparação é `>=`, era gravado como
 * certeza. Um item que casou metade dos termos não é uma certeza — é um palpite.
 * Com o bônus de cabeça (ver `searchFood`), match bom passa folgado de 0.6.
 */
export const TACO_MATCH_THRESHOLD = 0.6;

const FOODS: readonly TacoFood[] = dataset.foods as readonly TacoFood[];
const BY_ID = new Map(FOODS.map((f) => [f.id, f]));

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'que', 'com', 'por', 'para', 'se', 'ao', 'à', 'é', 'sem', 'tipo',
]);

function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  // Singularização ingênua ("feijões"→"feijoe"→"feijo" não; usamos regras leves):
  return tokens.map((t) => {
    if (t.length <= 3) return t;
    if (t.endsWith('oes') || t.endsWith('aes')) return `${t.slice(0, -3)}ao`;
    if (t.endsWith('s')) return t.slice(0, -1);
    return t;
  });
}

interface IndexedFood {
  readonly food: TacoFood;
  readonly tokens: readonly string[];
  readonly tokenSet: ReadonlySet<string>;
}

// Indexa APENAS a descrição — a categoria contém termos genéricos ("Alimentos
// preparados") que gerariam falsos positivos para consultas sem relação.
const INDEX: readonly IndexedFood[] = FOODS.map((food) => {
  const tokens = tokenize(food.description);
  return { food, tokens, tokenSet: new Set(tokens) };
});

// Sinônimos coloquiais → termos como aparecem nas descrições da TACO. Lista curta
// e deliberada (só termos MUITO comuns em recordatório que não existem na tabela).
const QUERY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // "bife" não existe na TACO; o corte usual é contra-filé (tokeniza contra+file)
  bife: ['carne', 'bovina', 'contra', 'file'],
  frito: ['frita'],
  mamao: ['mamao', 'papaia'],
};

function expandQueryTokens(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const syn = QUERY_SYNONYMS[t];
    if (syn) out.push(...syn);
    else out.push(t);
  }
  return [...new Set(out)];
}

/**
 * Bônus para o alimento cujo termo de CABEÇA casa com a consulta.
 *
 * As descrições da TACO são "SubstantivoPrincipal, qualificador, qualificador"
 * ("Arroz, tipo 1, cozido"; "Morango, cru"). Quando o primeiro token casa, o item
 * É aquele alimento; quando ele aparece só no meio, o alimento é OUTRO que apenas
 * contém aquele ("Bolinho de arroz", "Biscoito recheado com morango", "Pão,
 * aveia, forma"). Sem este sinal, "aveia" casava com pão de aveia e "carne moída"
 * com estrogonofe — os dois tinham score idêntico ao do item certo.
 */
const HEAD_TOKEN_BONUS = 0.15;

/**
 * Penalidade para a variante CRUA quando o paciente não pediu "cru".
 *
 * Duas forças, e a distinção importa:
 *
 * FORTE (×0.6) — cereal ou leguminosa que TEM alternativa preparada na tabela.
 * É o caso que originou a regra: feijão cru tem 329 kcal/100 g contra 76 do
 * cozido, arroz cru 358 contra 128. Trocar um pelo outro triplica o total do dia.
 * A condição "tem alternativa preparada" é essencial — sem ela, "aveia" (cuja
 * única entrada na TACO é "Aveia, flocos, crua") era esmagada e perdia para
 * "Pão, aveia, forma". Penalizar o único item existente não protege ninguém.
 *
 * FRACA (×0.98) — todo o resto. Fruta e salada se comem CRUAS, e é assim que a
 * TACO as descreve ("Banana, prata, crua", "Morango, cru"): a penalidade forte
 * aqui foi um bug real. Mas um empurrãozinho ainda é útil para desempate — sem
 * ele, "feijão" casava com "Feijão, broto, cru" (broto de feijão, 39 kcal), que
 * a TACO classifica como hortaliça e que por isso escapava da regra forte.
 */
const RAW_PENALTY_STRONG = 0.6;
const RAW_PENALTY_WEAK = 0.98;

const STRONG_RAW_CATEGORIES: ReadonlySet<string> = new Set([
  'Cereais e derivados',
  'Leguminosas e derivados',
]);

/**
 * Termos de cabeça que possuem ao menos um item NÃO-cru na tabela. É o que
 * distingue "existe alternativa preparada" (arroz, feijão) de "só existe a forma
 * crua" (aveia) — e sem essa distinção a penalidade forte pune o inocente.
 */
const HEADS_WITH_PREPARED: ReadonlySet<string> = (() => {
  const heads = new Set<string>();
  for (const entry of INDEX) {
    const head = entry.tokens[0];
    if (head === undefined) continue;
    if (!entry.tokenSet.has('cru') && !entry.tokenSet.has('crua')) heads.add(head);
  }
  return heads;
})();

/**
 * Busca os k alimentos mais próximos da consulta. O score pondera cobertura da
 * consulta (peso maior — o que o paciente disse precisa estar no item), concisão
 * do item e o bônus de cabeça (ver `HEAD_TOKEN_BONUS`).
 *
 * ATENÇÃO ao mexer aqui: esta busca é o FALLBACK. O que o paciente digita com
 * frequência é resolvido pelo catálogo curado (`@nutrimed/food-catalog`), porque
 * há casos que nenhum score resolve — "Frango, coração, grelhado" é, para a
 * consulta "frango grelhado", um match lexicalmente MELHOR que "Frango, peito,
 * sem pele, grelhado" (casa a mesma fração com menos sobra). Similaridade de
 * string não sabe qual alimento as pessoas comem; só a curadoria sabe.
 * Todo ajuste aqui precisa passar pelo corpus em `packages/food-catalog`.
 */
export function searchFood(query: string, k = 5): TacoMatch[] {
  const queryTokens = expandQueryTokens(tokenize(query));
  if (queryTokens.length === 0) return [];
  const queryWantsRaw = queryTokens.includes('cru') || queryTokens.includes('crua');

  const scored: TacoMatch[] = [];
  for (const entry of INDEX) {
    let matched = 0;
    for (const qt of queryTokens) {
      if (entry.tokenSet.has(qt)) matched += 1;
    }
    if (matched === 0) continue;
    const queryCoverage = matched / queryTokens.length;
    const foodCoverage = matched / entry.tokens.length;
    let score = queryCoverage * 0.75 + foodCoverage * 0.25;

    const head = entry.tokens[0];
    if (head !== undefined && queryTokens.includes(head)) score += HEAD_TOKEN_BONUS;

    const isRaw = entry.tokenSet.has('cru') || entry.tokenSet.has('crua');
    if (isRaw && !queryWantsRaw) {
      const temPreparado = head !== undefined && HEADS_WITH_PREPARED.has(head);
      const forte = temPreparado && STRONG_RAW_CATEGORIES.has(entry.food.category);
      score *= forte ? RAW_PENALTY_STRONG : RAW_PENALTY_WEAK;
    }

    scored.push({ food: entry.food, score: Math.round(Math.min(score, 1) * 1000) / 1000 });
  }

  scored.sort((a, b) => b.score - a.score || a.food.description.length - b.food.description.length);
  return scored.slice(0, k);
}

export function getFood(id: string): TacoFood | null {
  return BY_ID.get(id) ?? null;
}

export function listFoods(): readonly TacoFood[] {
  return FOODS;
}
