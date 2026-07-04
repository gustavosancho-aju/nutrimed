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

/** Score mínimo para considerar um match confiável; abaixo disso o item deve ser sinalizado. */
export const TACO_MATCH_THRESHOLD = 0.5;

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
 * Busca os k alimentos mais próximos da consulta. Score pondera cobertura da consulta
 * (peso maior — o que o paciente disse precisa estar no item) e concisão do item
 * (desempate: "Arroz, cozido" ganha de "Arroz, com legumes, cozido" para "arroz").
 * Itens "cru(a)" só vencem se o paciente disse "cru" — recordatório descreve o que
 * foi COMIDO, e feijão cru (329 kcal/100 g) no lugar do cozido (76) triplicaria o total.
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
    if (!queryWantsRaw && (entry.tokenSet.has('cru') || entry.tokenSet.has('crua'))) {
      score *= 0.6; // variante crua só entra na falta de alternativa preparada
    }
    scored.push({ food: entry.food, score: Math.round(score * 1000) / 1000 });
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
