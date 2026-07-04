// (a) Extração do recordatório alimentar da transcrição — a IA lista O QUE o
// paciente relatou comer; ela NUNCA estima nutrientes (isso é papel do cálculo
// determinístico sobre a TACO). Sanitização com fronteira de confiança (ADR-012):
// só campos conhecidos, tipos válidos, listas limitadas.
import type { ILlmProvider } from '@nutrimed/providers';
import { stripJsonFences } from '@nutrimed/providers';

export const RECALL_MEALS = ['cafe', 'almoco', 'jantar', 'lanche', 'ceia', 'nao-informado'] as const;
export type RecallMeal = (typeof RECALL_MEALS)[number];

export interface RecallItem {
  /** Alimento/bebida como relatado (normalizado pela IA), ex.: "arroz branco cozido". */
  readonly food: string;
  /** Quantidade relatada — AUSENTE quando o paciente não disse (nunca inventada). */
  readonly quantity?: number;
  /** Unidade caseira relatada, ex.: "colher de sopa", "unidade", "copo". */
  readonly unit?: string;
  readonly meal?: RecallMeal;
}

const EXTRACT_SYSTEM =
  'Você extrai o recordatório alimentar da transcrição de uma consulta de nutrologia. ' +
  'Liste APENAS alimentos e bebidas que o PACIENTE relatou ter consumido — ignore hipóteses do médico, ' +
  'recomendações futuras, planos e exemplos hipotéticos. ' +
  'Normalize o nome do alimento em português simples (ex.: "arroz branco cozido", "pão francês"). ' +
  'Responda APENAS com um array JSON válido (sem cercas de código), no formato: ' +
  '[{"food":"arroz branco cozido","quantity":4,"unit":"colher de sopa","meal":"almoco"}] ' +
  `com meal em ${RECALL_MEALS.join('|')}. ` +
  'Se a quantidade não foi dita, OMITA quantity e unit — NÃO invente quantidades. ' +
  'Se a transcrição não menciona consumo de alimentos, responda [].';

const MAX_ITEMS = 60;
const MAX_FOOD_LEN = 120;
const MAX_UNIT_LEN = 40;

/** Fronteira de confiança: aceita apenas itens bem-formados; descarta o resto em silêncio. */
export function sanitizeRecall(raw: unknown): RecallItem[] {
  if (!Array.isArray(raw)) return [];
  const items: RecallItem[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.food !== 'string' || rec.food.trim().length === 0) continue;
    const item: {
      food: string;
      quantity?: number;
      unit?: string;
      meal?: RecallMeal;
    } = { food: rec.food.trim().slice(0, MAX_FOOD_LEN) };
    if (typeof rec.quantity === 'number' && Number.isFinite(rec.quantity) && rec.quantity > 0) {
      item.quantity = Math.round(rec.quantity * 100) / 100;
      if (typeof rec.unit === 'string' && rec.unit.trim().length > 0) {
        item.unit = rec.unit.trim().slice(0, MAX_UNIT_LEN);
      }
    }
    if (typeof rec.meal === 'string' && (RECALL_MEALS as readonly string[]).includes(rec.meal)) {
      item.meal = rec.meal as RecallMeal;
    }
    items.push(item);
  }
  return items;
}

/**
 * Extrai o recordatório da transcrição via LLM (completeText — texto livre com
 * contrato JSON próprio). Retorna [] quando a transcrição não menciona alimentos.
 */
export async function extractDietRecall(
  llm: ILlmProvider,
  transcriptFinals: readonly string[],
): Promise<RecallItem[]> {
  if (!llm.completeText) {
    throw new Error('O provedor de LLM não suporta completeText — necessário para a extração do recordatório.');
  }
  const transcript = transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const { text } = await llm.completeText({
    system: EXTRACT_SYSTEM,
    prompt: `Transcrição da consulta:\n${transcript}`,
    maxTokens: 1500,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    // saída malformada do modelo ⇒ trata como "nada extraído" (o médico regenera)
    return [];
  }
  return sanitizeRecall(parsed);
}
