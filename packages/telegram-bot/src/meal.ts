import {
  MEALS,
  MEAL_LABELS,
  parseMeal,
  type FoodLogValues,
  type Meal,
  type PendingFoodEntry,
} from '@nutrimed/patients';
import type { BotButton } from './bot';

/**
 * Pergunta da refeição (E16 Fase 2) — codificação dos botões, TTL do pendente e
 * textos. Separado de `bot.ts` para o dispatcher não virar um arquivo de 900
 * linhas; a lógica de negócio (gravar, somar) segue lá.
 *
 * DECISÃO DE PRODUTO: o bot PERGUNTA sempre, nunca infere pelo horário. Foi
 * escolha explícita do Gustavo, contra a recomendação de inferir + deixar
 * corrigir. A única exceção é o atalho: quando o paciente JÁ disse a refeição
 * ("/comi almoço 100g de arroz"), perguntar de novo seria ignorá-lo.
 */

/** 1 char por refeição — o `callback_data` do Telegram tem teto de 64 BYTES. */
const MEAL_CODE: Record<Meal, string> = {
  cafe_da_manha: 'c',
  almoco: 'a',
  jantar: 'j',
  lanche: 'l',
};

const CODE_TO_MEAL: Readonly<Record<string, Meal>> = Object.fromEntries(
  (Object.entries(MEAL_CODE) as [Meal, string][]).map(([meal, code]) => [code, meal]),
);

/** Prefixo do callback da refeição — distingue de outros botões futuros. */
const MEAL_PREFIX = 'm';

/**
 * `m:<uuid sem hífens>:<código>` = 2 + 32 + 1 + 1 = **36 bytes**, folgado dentro
 * dos 64 do Telegram. Os hífens saem só para caber com margem; o id é remontado
 * na volta. NÃO cabe (nem deve) o valor nutricional aqui: além do limite, seria
 * dado clínico em texto puro no servidor do Telegram (NFR9/ADR-013).
 */
export function mealCallbackData(pendingId: string, meal: Meal): string {
  return `${MEAL_PREFIX}:${pendingId.replace(/-/g, '')}:${MEAL_CODE[meal]}`;
}

export interface MealChoice {
  readonly pendingIdCompact: string;
  readonly meal: Meal;
}

/** Interpreta o `callback_data`. Devolve null se não for da refeição. */
export function parseMealCallback(data: string): MealChoice | null {
  const m = /^m:([0-9a-f]{32}):([cajl])$/.exec(data.trim());
  if (!m) return null;
  const meal = CODE_TO_MEAL[m[2]!];
  return meal ? { pendingIdCompact: m[1]!, meal } : null;
}

/** Compara o id do banco (com hífens) com o compacto que voltou do botão. */
export function matchesPendingId(pendingId: string, compact: string): boolean {
  return pendingId.replace(/-/g, '') === compact;
}

/** Teclado com as 4 refeições, em 2 linhas — cabe na tela do celular. */
export function mealButtons(pendingId: string): readonly (readonly BotButton[])[] {
  const [a, b, c, d] = MEALS;
  return [
    [
      { label: MEAL_LABELS[a!], data: mealCallbackData(pendingId, a!) },
      { label: MEAL_LABELS[b!], data: mealCallbackData(pendingId, b!) },
    ],
    [
      { label: MEAL_LABELS[c!], data: mealCallbackData(pendingId, c!) },
      { label: MEAL_LABELS[d!], data: mealCallbackData(pendingId, d!) },
    ],
  ];
}

/**
 * Teto de pendentes simultâneos. Acima disso o bot NÃO chama o estimador —
 * economia real de visão (lição do vazamento de custo de 2026-07-24) e sinal de
 * que a conversa travou, não de uso normal.
 */
export const MAX_PENDING = 3;

/** 12 h de janela, mas nunca atravessando o dia local + 3 h. */
const TTL_MS = 12 * 60 * 60 * 1000;
const GRACE_AFTER_MIDNIGHT_MS = 3 * 60 * 60 * 1000;

/**
 * Quando o pendente vira "sem resposta".
 *
 * Ninguém responde "que refeição foi" dois dias depois — e prender um registro
 * ATRAVÉS da virada do dia corromperia o `/hoje`, que é somado por dia local.
 * Por isso o teto duplo: 12 h OU o fim do dia local + 3 h de graça (para quem
 * janta 23h e responde 00h30).
 */
export function pendingExpiresAt(now: Date, tzOffsetMinutes: number): Date {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const endOfLocalDay = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  const endOfDayUtc = endOfLocalDay - tzOffsetMinutes * 60_000 + GRACE_AFTER_MIDNIGHT_MS;
  return new Date(Math.min(now.getTime() + TTL_MS, endOfDayUtc));
}

/** "12h47" no fuso do paciente — identifica o prato quando há mais de um pendente. */
export function localTimeLabel(at: Date, tzOffsetMinutes: number): string {
  const local = new Date(at.getTime() + tzOffsetMinutes * 60_000);
  return `${String(local.getUTCHours()).padStart(2, '0')}h${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

/** Resumo curto do prato pendente, para o paciente saber a qual se refere. */
export function describePending(p: PendingFoodEntry, tzOffsetMinutes: number): string {
  const hora = localTimeLabel(p.eatenAt, tzOffsetMinutes);
  const itens = p.values.itemsLabel ? ` — ${p.values.itemsLabel}` : '';
  return `das ${hora}${itens}`;
}

/** A pergunta em si. Mostra a estimativa ANTES de pedir a classificação. */
export function askMealText(values: FoodLogValues, quantosPendentes: number, resumo?: string): string {
  const cabeca =
    quantosPendentes > 1
      ? `De que refeição foi o prato ${resumo ?? 'anterior'}?`
      : 'De que refeição foi?';
  return `${cabeca}\n(toque em uma opção — ou responda /refeicao almoco)`;
}

/**
 * Refeição dita no começo do próprio texto ("/comi almoço 100g de arroz",
 * legenda "jantar: frango"). Devolve a refeição e o RESTO do texto.
 *
 * Existe para não perguntar o que o paciente já respondeu — "perguntar sempre"
 * vale quando ele NÃO disse.
 */
export function extractLeadingMeal(text: string): { meal: Meal | null; rest: string } {
  const m = /^\s*([a-zà-ÿ_ ]{3,20}?)\s*[:,-]\s*(.+)$/i.exec(text);
  if (m) {
    const meal = parseMeal(m[1]!);
    if (meal) return { meal, rest: m[2]!.trim() };
  }
  // Sem separador: tenta a primeira palavra ("almoço 100g de arroz").
  const words = text.trim().split(/\s+/);
  if (words.length > 1) {
    const meal = parseMeal(words[0]!);
    if (meal) return { meal, rest: words.slice(1).join(' ').trim() };
    // "café da manhã 2 ovos" — o rótulo tem 3 palavras
    for (const n of [3, 2]) {
      if (words.length > n) {
        const cand = parseMeal(words.slice(0, n).join(' '));
        if (cand) return { meal: cand, rest: words.slice(n).join(' ').trim() };
      }
    }
  }
  return { meal: null, rest: text };
}

export { MEAL_LABELS };
