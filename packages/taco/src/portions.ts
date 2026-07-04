// Porções caseiras padrão e conversão de unidades para gramas.
// Valores CONSERVADORES baseados em medidas caseiras usuais (referência IBGE/POF).
// Toda porção assumida (não dita pelo paciente) deve ser SINALIZADA como estimativa
// pelo consumidor deste módulo — aqui só ficam os números e os rótulos.
import type { TacoFood } from './search';

export interface Portion {
  /** Gramas da porção. */
  readonly grams: number;
  /** Rótulo legível para o médico, ex.: "1 concha média (100 g)". */
  readonly label: string;
}

interface PortionRule {
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly portion: Portion;
}

// Regras avaliadas em ordem: keyword na descrição vence categoria; categoria vence default.
const KEYWORD_RULES: readonly PortionRule[] = [
  { keywords: ['pao', 'pão'], portion: { grams: 50, label: '1 unidade (50 g)' } },
  { keywords: ['queijo', 'requeijao', 'requeijão'], portion: { grams: 30, label: '1 fatia (30 g)' } },
  { keywords: ['leite', 'iogurte', 'suco', 'refrigerante', 'vitamina'], portion: { grams: 200, label: '1 copo (200 ml)' } },
  { keywords: ['ovo'], portion: { grams: 50, label: '1 unidade (50 g)' } },
  { keywords: ['feijao', 'feijão', 'lentilha', 'grao', 'grão'], portion: { grams: 100, label: '1 concha média (100 g)' } },
  { keywords: ['arroz', 'macarrao', 'macarrão', 'purê', 'pure'], portion: { grams: 100, label: '≈ 4 colheres de sopa (100 g)' } },
  { keywords: ['oleo', 'óleo', 'azeite', 'manteiga', 'margarina'], portion: { grams: 10, label: '1 colher de sopa (10 g)' } },
  { keywords: ['acucar', 'açúcar', 'mel', 'doce', 'chocolate'], portion: { grams: 20, label: '1 colher de sopa (20 g)' } },
  { keywords: ['cafe', 'café', 'cha', 'chá'], portion: { grams: 100, label: '1 xícara (100 ml)' } },
];

const CATEGORY_PORTIONS: Readonly<Record<string, Portion>> = {
  'Cereais e derivados': { grams: 100, label: '≈ 4 colheres de sopa (100 g)' },
  'Leguminosas e derivados': { grams: 100, label: '1 concha média (100 g)' },
  'Verduras, hortaliças e derivados': { grams: 50, label: '1 porção pequena (50 g)' },
  'Frutas e derivados': { grams: 100, label: '1 unidade média (100 g)' },
  'Carnes e derivados': { grams: 100, label: '1 filé/porção média (100 g)' },
  'Pescados e frutos do mar': { grams: 100, label: '1 filé/porção média (100 g)' },
  'Leite e derivados': { grams: 200, label: '1 copo (200 ml)' },
  'Bebidas (alcoólicas e não alcoólicas)': { grams: 200, label: '1 copo (200 ml)' },
  'Ovos e derivados': { grams: 50, label: '1 unidade (50 g)' },
  'Gorduras e óleos': { grams: 10, label: '1 colher de sopa (10 g)' },
  'Produtos açucarados': { grams: 20, label: '1 colher de sopa (20 g)' },
  'Nozes e sementes': { grams: 30, label: '1 punhado (30 g)' },
  'Alimentos preparados': { grams: 150, label: '1 porção média (150 g)' },
};

const DEFAULT_PORTION: Portion = { grams: 100, label: 'porção de referência (100 g)' };

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Porção padrão para quando o paciente não informou quantidade. */
export function defaultPortionGrams(food: TacoFood): Portion {
  const desc = normalize(food.description);
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords?.some((kw) => desc.includes(normalize(kw)))) return rule.portion;
  }
  return CATEGORY_PORTIONS[food.category] ?? DEFAULT_PORTION;
}

// Peso em gramas de UMA unidade caseira, resolvido por palavra-chave (tolera plural
// e variações: "colheres de sopa", "copos americanos"...). 'unidade', 'fatia' e afins
// dependem do alimento — usam a porção padrão dele como peso unitário.
const UNIT_KEYWORD_GRAMS: readonly { match: (u: string) => boolean; grams: number }[] = [
  { match: (u) => u.includes('colher') && u.includes('cha'), grams: 5 },
  { match: (u) => u.includes('colher'), grams: 15 },
  { match: (u) => u.includes('xicara'), grams: 120 },
  { match: (u) => u.includes('copo') || u.includes('lata'), grams: 200 },
  { match: (u) => u.includes('concha'), grams: 100 },
  { match: (u) => u.includes('prato'), grams: 250 },
  { match: (u) => u.includes('punhado'), grams: 30 },
  { match: (u) => /^l(itro)?s?$/.test(u), grams: 1000 },
  { match: (u) => /^ml$/.test(u) || /^(g|grama|gramas)$/.test(u), grams: 1 },
];

const FOOD_SIZED_UNIT_KEYWORDS = ['unidade', 'fatia', 'file', 'pedaco', 'porcao', 'bife', 'posta', 'pote'];

/**
 * Converte quantidade+unidade relatadas em gramas. Retorna null quando a unidade é
 * desconhecida — o consumidor decide cair na porção padrão (sinalizada).
 */
export function gramsForQuantity(food: TacoFood, quantity: number, unit: string): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const u = normalize(unit).trim();
  if (FOOD_SIZED_UNIT_KEYWORDS.some((kw) => u.includes(kw))) {
    return quantity * defaultPortionGrams(food).grams;
  }
  for (const rule of UNIT_KEYWORD_GRAMS) {
    if (rule.match(u)) return quantity * rule.grams;
  }
  return null;
}
