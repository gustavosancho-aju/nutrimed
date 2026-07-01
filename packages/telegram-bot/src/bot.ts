import type { SqlExecutor } from '@nutrimed/db';
import {
  addFoodLogEntry,
  findLatestFoodLogEntry,
  updateFoodLogEntryValues,
  sumFoodLogForDay,
  loadCurrentNutritionGoal,
  type DailyProgress,
} from '@nutrimed/patients';
import {
  isChannelAuthorized,
  resolvePatientByChat,
  redeemPairingCode,
} from '@nutrimed/telegram-link';
import type { IFoodEstimator, FoodImageInput, FoodEstimate, FoodConfidence } from '@nutrimed/food-vision';
import type { ILlmProvider } from '@nutrimed/providers';

/**
 * Lógica pura do bot de Telegram (E12 — 12.6). SEM transporte: recebe uma foto
 * já baixada (`FoodImageInput`) e um `chat_id`, e devolve texto (`BotReply`). O
 * webhook/long-polling (grammy) fica na 12.7. Assim a lógica é testável com fakes
 * e o canal é trocável sem reescrever regras (ADR-013 Decisão 4).
 *
 * Encadeia os serviços já construídos: gate de consentimento (`@nutrimed/telegram-link`),
 * estimativa por foto (`@nutrimed/food-vision`) e registro/agregação cifrados e
 * auditados (`@nutrimed/patients`). Toda estimativa vem com disclaimer (ADR-015);
 * sem meta, o bot informa e não inventa. A orientação por IA rica entra na 12.8.
 */

/** Fuso padrão do piloto (BR, UTC-3) em minutos: local = UTC + offset. */
const DEFAULT_TZ = -180;

export interface BotDeps {
  readonly db: SqlExecutor;
  readonly key: Buffer;
  /** Estimador de foto; `null` (prod sem key) ⇒ o bot informa indisponibilidade. */
  readonly estimator: IFoodEstimator | null;
  /** Provedor de orientação textual (12.8); `null`/ausente ⇒ só feedback factual. */
  readonly llm?: ILlmProvider | null;
  /**
   * Re-baixa a foto de um `photoRef` (file_id do Telegram) — fornecido pelo
   * transporte. Habilita o /corrigir reestimar o prato; ausente ⇒ o bot pede o
   * reenvio da foto com legenda (degradação graciosa).
   */
  readonly downloadPhoto?: (photoRef: string) => Promise<FoodImageInput>;
  /** Relógio injetável (testável); default `() => new Date()` no ponto de uso. */
  readonly now?: () => Date;
  /** Offset do fuso em minutos (default BR = -180). */
  readonly tzOffsetMinutes?: number;
}

export interface BotReply {
  readonly text: string;
}

/** Update já normalizado pelo transporte (12.7) — a lógica não conhece o grammy. */
export interface BotUpdate {
  readonly chatId: string;
  readonly text?: string;
  readonly photo?: FoodImageInput;
  readonly photoRef?: string;
  /** Legenda da foto — descrição do paciente que orienta a estimativa. */
  readonly caption?: string;
}

const DISCLAIMER =
  'ℹ️ Estimativa automática e aproximada — não substitui a orientação do seu nutricionista.';

const CORRECT_TIP =
  '✏️ Identifiquei algo errado? Responda /corrigir com o ajuste (ex.: /corrigir era frango grelhado, não peixe).';

const WELCOME =
  '👋 Olá! Sou o assistente nutricional do seu consultório. Para começar, peça um código de ' +
  'vínculo ao seu nutricionista e me envie: /start SEUCÓDIGO.\n\n' +
  'ℹ️ Suas mensagens passam pelo Telegram (serviço externo) — o vínculo é o seu consentimento ' +
  'e pode ser revogado a qualquer momento.';

const NEEDS_PAIRING =
  'Seu canal ainda não está ativo. Peça um código ao seu nutricionista e envie /start CÓDIGO para começar.';

const CONFIDENCE_PT: Record<FoodConfidence, string> = {
  low: 'baixa',
  medium: 'média',
  high: 'alta',
};

function clock(deps: BotDeps): Date {
  return deps.now?.() ?? new Date();
}

function tz(deps: BotDeps): number {
  return deps.tzOffsetMinutes ?? DEFAULT_TZ;
}

/** Dia local (`YYYY-MM-DD`) para um instante, dado o offset do fuso. */
function localDayISO(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function formatEstimate(e: FoodEstimate): string {
  const v = e.values;
  const items = e.itemsLabel ? ` (${e.itemsLabel})` : '';
  return (
    `🍽️ Estimativa aproximada deste prato${items}:\n` +
    `~${Math.round(v.kcal)} kcal · P ${Math.round(v.protein)} g · C ${Math.round(v.carbs)} g · G ${Math.round(v.fat)} g\n` +
    `Confiança: ${CONFIDENCE_PT[e.confidence]}.`
  );
}

function formatProgress(p: DailyProgress): string {
  const c = p.consumed;
  if (!p.goal || !p.remaining) {
    return (
      `📊 Hoje: ~${Math.round(c.kcal)} kcal · P ${Math.round(c.protein)} g · C ${Math.round(c.carbs)} g · G ${Math.round(c.fat)} g.\n` +
      'Seu nutricionista ainda não definiu suas metas.'
    );
  }
  const g = p.goal;
  const faltam = Math.max(0, Math.round(p.remaining.kcal));
  return (
    `📊 Hoje: ~${Math.round(c.kcal)}/${Math.round(g.kcal)} kcal (faltam ~${faltam}).\n` +
    `P ${Math.round(c.protein)}/${Math.round(g.protein)} g · C ${Math.round(c.carbs)}/${Math.round(g.carbs)} g · G ${Math.round(c.fat)}/${Math.round(g.fat)} g.`
  );
}

const ORIENT_SYSTEM =
  'Você dá UMA frase curta e acolhedora de orientação nutricional geral a um paciente, com ' +
  'base no consumo do dia frente à meta definida pelo nutricionista. Regras: no máximo uma ' +
  'frase; tom gentil e motivador; NÃO seja prescritivo (não recomende doses, medicamentos ou ' +
  'dietas específicas); não repita os números; não faça diagnóstico.';

/** Resumo factual da situação (entra como `transcript` do LLM). */
function describeSituation(progress: DailyProgress, estimate?: FoodEstimate): string {
  const parts: string[] = [];
  if (estimate) {
    parts.push(`Prato atual estimado em ~${Math.round(estimate.values.kcal)} kcal (confiança ${estimate.confidence}).`);
  }
  if (progress.goal && progress.remaining) {
    parts.push(
      `Consumo do dia: ~${Math.round(progress.consumed.kcal)} de ${Math.round(progress.goal.kcal)} kcal ` +
        `(faltam ~${Math.max(0, Math.round(progress.remaining.kcal))}).`,
    );
  } else {
    parts.push(`Consumo do dia: ~${Math.round(progress.consumed.kcal)} kcal. Sem meta definida pelo nutricionista.`);
  }
  return parts.join(' ');
}

/**
 * Frase curta de orientação via LLM (12.8). Sem provedor ou em falha ⇒ null: o
 * bot mantém o feedback factual (degradação graciosa — a orientação é um "verniz").
 */
async function buildOrientation(
  llm: ILlmProvider | null | undefined,
  progress: DailyProgress,
  estimate?: FoodEstimate,
): Promise<string | null> {
  if (!llm) return null;
  try {
    const contribution = await llm.complete({
      system: ORIENT_SYSTEM,
      context: [],
      transcript: describeSituation(progress, estimate),
    });
    return contribution.text?.trim() || null;
  } catch {
    return null;
  }
}

/** Junta as seções não-vazias da resposta (2 quebras de linha entre elas). */
function compose(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join('\n\n');
}

/** `/start [código]` — boas-vindas ou pareamento (o resgate é o consentimento). */
export async function handleStart(deps: BotDeps, chatId: string, arg?: string): Promise<BotReply> {
  const code = arg?.trim();
  if (!code) return { text: WELCOME };

  const result = await redeemPairingCode(deps.db, chatId, code);
  if (result.ok) {
    return {
      text:
        '✅ Canal ativado! Agora é só me enviar a foto do seu prato que eu estimo os nutrientes ' +
        '(a legenda da foto me ajuda a identificar os alimentos). Use /hoje para ver seu progresso ' +
        'do dia, /meta para suas metas e /corrigir se eu identificar algo errado.',
    };
  }
  const reason = { invalid: 'Código inválido.', expired: 'Código expirado.', consumed: 'Esse código já foi usado.' }[
    result.reason
  ];
  return { text: `${reason} Peça um novo código ao seu nutricionista e envie /start CÓDIGO.` };
}

/**
 * Foto do prato → estimativa → registro auditado → feedback vs. meta + disclaimer.
 * A legenda da foto (`caption`), se houver, orienta a identificação dos alimentos.
 */
export async function handlePhoto(
  deps: BotDeps,
  chatId: string,
  image: FoodImageInput,
  photoRef?: string,
  caption?: string,
): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  if (!deps.estimator) {
    return { text: 'No momento não consigo estimar sua foto (serviço indisponível). Tente novamente mais tarde.' };
  }

  const estimate = await deps.estimator.estimate(image, caption?.trim() || undefined);
  const modelVersion = deps.estimator.modelVersion;
  const now = clock(deps);

  await addFoodLogEntry(
    deps.db,
    patientId,
    {
      eatenAt: now,
      values: {
        ...estimate.values,
        confidence: estimate.confidence,
        ...(estimate.itemsLabel ? { itemsLabel: estimate.itemsLabel } : {}),
      },
      ...(photoRef ? { photoRef } : {}),
      ...(modelVersion ? { modelVersion } : {}),
    },
    deps.key,
    { action: 'telegram-bot', ...(modelVersion ? { modelVersion } : {}) },
  );

  const progress = await sumFoodLogForDay(deps.db, patientId, localDayISO(now, tz(deps)), tz(deps), deps.key);
  const orientation = await buildOrientation(deps.llm, progress, estimate);
  return { text: compose([formatEstimate(estimate), formatProgress(progress), orientation, CORRECT_TIP, DISCLAIMER]) };
}

/**
 * `/corrigir <ajuste>` — o paciente corrige a identificação do último prato do
 * dia (ex.: "era frango, não peixe"). Reestima a MESMA foto (re-baixada pelo
 * `photoRef`) com a correção como dica e ATUALIZA a entrada existente — o
 * consumo do dia não duplica. Sem foto recuperável ⇒ pede reenvio com legenda.
 */
export async function handleCorrection(deps: BotDeps, chatId: string, correction: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const text = correction.trim();
  if (!text) {
    return {
      text: 'Me diga o que ajustar: /corrigir descrição do prato (ex.: /corrigir era frango grelhado, não peixe).',
    };
  }
  if (!deps.estimator) {
    return { text: 'No momento não consigo reestimar seu prato (serviço indisponível). Tente novamente mais tarde.' };
  }

  const now = clock(deps);
  const today = localDayISO(now, tz(deps));
  const entry = await findLatestFoodLogEntry(deps.db, patientId, deps.key);
  if (!entry || localDayISO(entry.eatenAt, tz(deps)) !== today) {
    return { text: 'Não encontrei um prato registrado hoje para corrigir. Envie a foto do prato primeiro.' };
  }
  if (!entry.photoRef || !deps.downloadPhoto) {
    return {
      text: 'Não consigo rever a foto desse prato. Envie a foto novamente com a descrição na legenda que eu reestimo.',
    };
  }

  let image: FoodImageInput;
  try {
    image = await deps.downloadPhoto(entry.photoRef);
  } catch {
    return {
      text: 'Não consegui recuperar a foto desse prato. Envie a foto novamente com a descrição na legenda que eu reestimo.',
    };
  }

  const estimate = await deps.estimator.estimate(image, text);
  const modelVersion = deps.estimator.modelVersion;
  await updateFoodLogEntryValues(
    deps.db,
    patientId,
    entry.id,
    {
      ...estimate.values,
      confidence: estimate.confidence,
      ...(estimate.itemsLabel ? { itemsLabel: estimate.itemsLabel } : {}),
    },
    deps.key,
    modelVersion,
    { action: 'telegram-bot-correct', ...(modelVersion ? { modelVersion } : {}) },
  );

  const progress = await sumFoodLogForDay(deps.db, patientId, today, tz(deps), deps.key);
  const orientation = await buildOrientation(deps.llm, progress, estimate);
  return {
    text: compose([
      '✏️ Ajustado! Reestimei o prato com a sua correção.',
      formatEstimate(estimate),
      formatProgress(progress),
      orientation,
      DISCLAIMER,
    ]),
  };
}

/** `/hoje` — progresso do dia vs. meta. */
export async function handleToday(deps: BotDeps, chatId: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const now = clock(deps);
  const progress = await sumFoodLogForDay(deps.db, patientId, localDayISO(now, tz(deps)), tz(deps), deps.key);
  const orientation = await buildOrientation(deps.llm, progress);
  return { text: compose([formatProgress(progress), orientation, DISCLAIMER]) };
}

/** `/meta` — metas vigentes (definidas pelo nutricionista). Sem meta ⇒ informa. */
export async function handleGoal(deps: BotDeps, chatId: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const now = clock(deps);
  const goal = await loadCurrentNutritionGoal(deps.db, patientId, deps.key, localDayISO(now, tz(deps)));
  if (!goal) {
    return { text: 'Seu nutricionista ainda não definiu suas metas. Assim que definir, elas aparecem aqui.' };
  }
  const g = goal.values;
  return {
    text:
      `🎯 Suas metas diárias (desde ${goal.effectiveFrom}):\n` +
      `~${Math.round(g.kcal)} kcal · P ${Math.round(g.protein)} g · C ${Math.round(g.carbs)} g · G ${Math.round(g.fat)} g.`,
  };
}

/** Dispatcher: foto → estimativa; `/start`/`/hoje`/`/meta`/`/corrigir`; senão ajuda. */
export async function handleUpdate(deps: BotDeps, update: BotUpdate): Promise<BotReply | null> {
  if (update.photo) return handlePhoto(deps, update.chatId, update.photo, update.photoRef, update.caption);

  const text = update.text?.trim();
  if (!text) return null;
  if (/^\/start\b/i.test(text)) {
    const arg = text.replace(/^\/start\b/i, '').trim() || undefined;
    return handleStart(deps, update.chatId, arg);
  }
  if (/^\/hoje\b/i.test(text)) return handleToday(deps, update.chatId);
  if (/^\/meta\b/i.test(text)) return handleGoal(deps, update.chatId);
  if (/^\/corrigir\b/i.test(text)) {
    return handleCorrection(deps, update.chatId, text.replace(/^\/corrigir\b/i, '').trim());
  }
  return {
    text:
      'Não entendi. Envie a foto do seu prato, ou use /hoje, /meta e /corrigir (ajusta o último prato). ' +
      'Se ainda não vinculou, use /start CÓDIGO.',
  };
}
