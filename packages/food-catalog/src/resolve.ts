import { searchFood, getFood, TACO_MATCH_THRESHOLD, TACO_VERSION, type TacoFood } from '@nutrimed/taco';
import { blockedTerm, lookupAlias, normalizeTerm, type FoodRef } from './catalog';
import { EXTRA_FOODS_VERSION, getExtraFood, AMBIGUOUS_FOODS, type ExtraFood } from './extra-foods';

/**
 * Resolução de um termo do paciente em um alimento com nutrientes (E16).
 *
 * É o ÚNICO ponto de entrada que os consumidores devem usar — `searchFood` da
 * TACO passa a ser detalhe interno. A ordem importa e é deliberada:
 *
 *   1. **Catálogo curado** (determinístico, O(1)) — vence sempre. É onde mora o
 *      conhecimento de qual alimento as pessoas de fato comem.
 *   2. **Termo bloqueado** — alimento comum que a TACO não tem e para o qual não
 *      há fonte de licença compatível. Devolve `null` com motivo, em vez de
 *      deixar a busca lexical achar um primo distante e errado por 10×.
 *   3. **Ambíguo por natureza** — barra de proteína e afins, cuja faixa real é
 *      larga demais para um valor genérico. Devolve `null` pedindo o que falta.
 *   4. **Busca lexical** na TACO — só então, e com a confiança que o score der.
 *
 * NADA aqui usa LLM: a resolução é determinística e auditável de ponta a ponta.
 * (A desambiguação por IA, quando existir, escolhe um id de uma LISTA que este
 * módulo produz — ela nunca emite nutriente.)
 */

// Mesmo motivo do BLOCKED_BY_KEY: a consulta usa o termo normalizado.
const AMBIGUOUS_BY_KEY = new Map<string, string>(
  Object.entries(AMBIGUOUS_FOODS).map(([term, msg]) => [normalizeTerm(term), msg]),
);

export type ResolutionVia = 'catalogo' | 'busca';

export interface ResolvedFood {
  /** Id na fonte de origem: número da TACO ou `nm-*` da tabela própria. */
  readonly id: string;
  readonly description: string;
  readonly category: string;
  readonly per100g: Readonly<Record<string, number>>;
  /** Qual tabela deu o número — vai para a proveniência auditada (NFR10). */
  readonly source: 'taco' | 'nutrimed';
  readonly via: ResolutionVia;
  /** 0..1. Catálogo curado é 1 por definição (foi decidido à mão). */
  readonly score: number;
  /** false ⇒ o consumidor DEVE sinalizar a incerteza ao paciente. */
  readonly confident: boolean;
}

/** Por que um termo não virou alimento — a mensagem é mostrada ao paciente. */
export interface UnresolvedFood {
  readonly term: string;
  readonly reason: 'bloqueado' | 'ambiguo' | 'sem-match';
  /** Explicação em pt-BR, já pronta para o bot. */
  readonly message: string;
}

export type FoodResolution =
  | { readonly ok: true; readonly food: ResolvedFood }
  | { readonly ok: false; readonly miss: UnresolvedFood };

function fromTaco(food: TacoFood, via: ResolutionVia, score: number, confident: boolean): ResolvedFood {
  return {
    id: food.id,
    description: food.description,
    category: food.category,
    per100g: food.per100g,
    source: 'taco',
    via,
    score,
    confident,
  };
}

function fromExtra(food: ExtraFood): ResolvedFood {
  return {
    id: food.id,
    description: food.description,
    category: food.category,
    per100g: food.per100g,
    source: 'nutrimed',
    via: 'catalogo',
    score: 1,
    confident: true,
  };
}

function deref(ref: FoodRef): ResolvedFood | null {
  if (ref.source === 'nutrimed') {
    const extra = getExtraFood(ref.id);
    return extra ? fromExtra(extra) : null;
  }
  const food = getFood(ref.id);
  // Confiança 1: o item foi escolhido à mão, não por similaridade.
  return food ? fromTaco(food, 'catalogo', 1, true) : null;
}

export function resolveFood(term: string): FoodResolution {
  const clean = term.trim();
  if (!clean) {
    return { ok: false, miss: { term, reason: 'sem-match', message: 'Não identifiquei o alimento.' } };
  }

  // 1. catálogo curado — vence a busca sempre
  const alias = lookupAlias(clean);
  if (alias) {
    const resolved = deref(alias.ref);
    // Referência quebrada é bug de catálogo, não do paciente: cai para a busca
    // em vez de derrubar o registro. O teste de integridade impede que aconteça.
    if (resolved) return { ok: true, food: resolved };
  }

  // 2. alimento comum sem fonte aceitável — melhor não registrar que registrar errado
  const blocked = blockedTerm(clean);
  if (blocked) {
    return {
      ok: false,
      miss: {
        term: clean,
        reason: 'bloqueado',
        message:
          `ainda não tenho ${blocked} na minha tabela com um valor confiável, então preferi não ` +
          'chutar. Se puder, mande a foto do prato que eu estimo.',
      },
    };
  }

  // 3. ambíguo por natureza (faixa larga demais para valor genérico)
  const ambiguous = AMBIGUOUS_BY_KEY.get(normalizeTerm(clean));
  if (ambiguous) {
    return { ok: false, miss: { term: clean, reason: 'ambiguo', message: ambiguous } };
  }

  // 4. busca lexical na TACO
  const [match] = searchFood(clean, 1);
  if (!match) {
    return {
      ok: false,
      miss: {
        term: clean,
        reason: 'sem-match',
        message: 'não encontrei esse alimento na tabela TACO.',
      },
    };
  }
  return {
    ok: true,
    food: fromTaco(match.food, 'busca', match.score, match.score >= TACO_MATCH_THRESHOLD),
  };
}

/**
 * Candidatos para desambiguação — a lista que um humano (ou, no futuro, um LLM
 * escolhendo um id) usaria para decidir. Nunca inclui nutriente calculado: quem
 * escolhe, escolhe o ITEM.
 */
export function foodCandidates(term: string, k = 5): readonly ResolvedFood[] {
  return searchFood(term, k).map((m) => fromTaco(m.food, 'busca', m.score, m.score >= TACO_MATCH_THRESHOLD));
}

/**
 * Proveniência das tabelas usadas, para o `model_version` do registro. Inclui as
 * duas versões porque uma refeição pode combinar TACO e tabela própria, e a
 * trilha precisa dizer qual valor veio de onde.
 */
export const FOOD_TABLES_VERSION = `${TACO_VERSION}+${EXTRA_FOODS_VERSION}`;
