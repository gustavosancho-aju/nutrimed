// Registro alimentar por TEXTO do paciente (Telegram `/comi`) — parser
// DETERMINÍSTICO, sem LLM: "100g de arroz, 2 colheres de feijão" → RecallItem[].
// A partir daí o fluxo é o MESMO do recordatório da consulta (mapRecallToTaco +
// computeNutrition), então os números continuam saindo só da TACO: nem a IA nem
// este parser estimam nutrientes — ele apenas interpreta o que o paciente digitou.
//
// Quando o paciente informa a quantidade (o caso que este comando existe para
// atender), o único ponto de incerteza que sobra é o match na TACO — bem menos
// que a foto, onde a visão chuta o alimento E a porção.
import type { RecallItem } from './extract';

const MAX_ITEMS = 30;
const MAX_FOOD_LEN = 120;

/** Verbos com que o paciente costuma introduzir a refeição — ruído para o match. */
const LEADING_VERBS = /^(?:comi|tomei|bebi|almocei|jantei|lanchei|consumi|eu)\s+/;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  meio: 0.5,
  meia: 0.5,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
};

// Unidades reconhecidas — alinhadas com `gramsForQuantity` (@nutrimed/taco), que
// faz a conversão para gramas. A ORDEM importa: alternativas longas antes das
// curtas, senão 'g' casaria antes de 'gramas' e 'l' antes de 'litro'.
const UNIT = [
  'colher(?:es)?(?:\\s+de\\s+(?:sopa|cha|cafe))?',
  'xicaras?',
  'copos?',
  'conchas?',
  'pratos?',
  'punhados?',
  'latas?',
  'unidades?',
  'fatias?',
  'files?',
  'pedacos?',
  'porcoes',
  'porcao',
  'bifes?',
  'postas?',
  'potes?',
  'gramas?',
  'gr',
  'g',
  'litros?',
  'l',
  'ml',
].join('|');

const NUM = '\\d+(?:[.,]\\d+)?';
const QTY = `(?:${NUM}|${Object.keys(NUMBER_WORDS).join('|')})`;

/** "100g de arroz", "2 colheres de sopa de feijão", "3 ovos" */
const LEADING_QTY = new RegExp(`^(${QTY})\\s*(${UNIT})?\\b\\s*(.*)$`);
/** "frango grelhado 150g" (quantidade no fim) */
const TRAILING_QTY = new RegExp(`^(.*?)\\s+(${QTY})\\s*(${UNIT})\\b\\s*$`);

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function toQuantity(raw: string): number | null {
  const word = NUMBER_WORDS[raw];
  if (word !== undefined) return word;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Remove preposição inicial ("de arroz" → "arroz") e pontuação final. */
function cleanFood(raw: string): string {
  return raw
    .replace(/^(?:de|do|da|dos|das)\s+/, '')
    .replace(/[.!?;:]+$/, '')
    .trim()
    .slice(0, MAX_FOOD_LEN);
}

/**
 * Interpreta o texto livre do paciente como uma lista de itens consumidos.
 * Itens sem quantidade saem SEM `quantity` — o `mapRecallToTaco` assume a porção
 * padrão e a sinaliza como estimada (nunca inventamos quantidade em silêncio).
 * Texto que não produz nenhum item reconhecível ⇒ lista vazia (o bot orienta).
 */
export function parseFoodText(text: string): RecallItem[] {
  const segments = stripAccents(text).toLowerCase().split(/[,;\n+]|\s+e\s+/);
  const items: RecallItem[] = [];

  for (const rawSegment of segments) {
    if (items.length >= MAX_ITEMS) break;
    const segment = rawSegment.trim().replace(LEADING_VERBS, '').trim();
    if (!segment) continue;

    let quantity: number | null = null;
    let unit: string | undefined;
    let food = segment;

    const lead = LEADING_QTY.exec(segment);
    const trail = lead ? null : TRAILING_QTY.exec(segment);
    if (lead) {
      quantity = toQuantity(lead[1]!);
      unit = lead[2]?.trim() || undefined;
      food = lead[3] ?? '';
    } else if (trail) {
      food = trail[1] ?? '';
      quantity = toQuantity(trail[2]!);
      unit = trail[3]?.trim() || undefined;
    }

    food = cleanFood(food);
    if (food.length < 2) continue;

    const item: { food: string; quantity?: number; unit?: string } = { food };
    if (quantity !== null) {
      item.quantity = quantity;
      if (unit) item.unit = unit;
    }
    items.push(item);
  }

  return items;
}
