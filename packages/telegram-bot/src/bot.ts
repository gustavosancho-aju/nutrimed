import type { SqlExecutor } from '@nutrimed/db';
import {
  addFoodLogEntry,
  addPendingFoodEntry,
  listPendingFoodEntries,
  confirmPendingFoodEntry,
  flushExpiredPendingEntries,
  findLatestFoodLogEntry,
  updateFoodLogEntryValues,
  sumFoodLogForDay,
  loadCurrentNutritionGoal,
  parseMeal,
  MEAL_LABELS,
  type DailyProgress,
  type FoodLogInput,
  type Meal,
} from '@nutrimed/patients';
import {
  isChannelAuthorized,
  resolvePatientByChat,
  redeemPairingCode,
} from '@nutrimed/telegram-link';
import {
  parseFoodText,
  mapRecallToTaco,
  computeNutrition,
  type MappedItem,
} from '@nutrimed/nutrition-report';
import { FOOD_TABLES_VERSION } from '@nutrimed/food-catalog';
import {
  MAX_PENDING,
  askMealText,
  describePending,
  extractLeadingMeal,
  matchesPendingId,
  mealButtons,
  parseMealCallback,
  pendingExpiresAt,
} from './meal';
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

/** Botão inline. `data` viaja até o Telegram e volta — teto de 64 BYTES. */
export interface BotButton {
  readonly label: string;
  readonly data: string;
}

export interface BotReply {
  readonly text: string;
  /**
   * Botões inline. O array externo são LINHAS. Ausente ⇒ mensagem simples.
   * A lógica decide o que oferecer; o transporte traduz para `reply_markup`.
   */
  readonly buttons?: readonly (readonly BotButton[])[];
  /**
   * Texto do "toast" que o Telegram mostra ao tocar o botão. Curto (≤200 ch).
   * Só faz sentido em resposta a `callbackData`.
   */
  readonly callbackAck?: string;
}

/** Update já normalizado pelo transporte (12.7) — a lógica não conhece o grammy. */
export interface BotUpdate {
  readonly chatId: string;
  readonly text?: string;
  readonly photo?: FoodImageInput;
  readonly photoRef?: string;
  /** Legenda da foto — descrição do paciente que orienta a estimativa. */
  readonly caption?: string;
  /** Payload do botão tocado (`callback_query.data`). */
  readonly callbackData?: string;
  /** Id do callback — o transporte PRECISA respondê-lo, senão o botão fica girando. */
  readonly callbackId?: string;
  /** Mensagem que carregava os botões, para o transporte removê-los depois. */
  readonly messageId?: number;
  /**
   * Quem tocou o botão. Em GRUPO o vínculo é por chat, não por usuário: isto não
   * autentica ninguém, mas deixa a ação rastreável na auditoria em vez de anônima.
   */
  readonly fromId?: string;
  /** Tipo do chat — mensagem proativa e texto livre se comportam diferente em grupo. */
  readonly chatType?: 'private' | 'group' | 'supergroup' | 'channel';
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
        '(a legenda da foto me ajuda a identificar os alimentos). Se preferir digitar — ou se você ' +
        'pesou a comida — use /comi 100g de arroz, 150g de frango: com as quantidades a conta fica ' +
        'mais precisa.\n\n' +
        'Depois de cada registro eu pergunto de que refeição foi — é só tocar no botão. Se quiser ' +
        'pular essa etapa, diga junto: /comi almoço 100g de arroz.\n\n' +
        'Use /hoje para ver seu progresso do dia, /meta para suas metas e /corrigir se eu ' +
        'identificar algo errado.',
    };
  }
  const reason = { invalid: 'Código inválido.', expired: 'Código expirado.', consumed: 'Esse código já foi usado.' }[
    result.reason
  ];
  return { text: `${reason} Peça um novo código ao seu nutricionista e envie /start CÓDIGO.` };
}

/**
 * Varredura preguiçosa dos pendentes vencidos deste paciente. Roda no topo dos
 * handlers enquanto não existe o agendador (que assume isso na Fase 3). Nunca
 * lança: perder a varredura é aceitável, derrubar o registro do paciente não.
 */
async function flushExpired(deps: BotDeps, patientId: string): Promise<void> {
  try {
    await flushExpiredPendingEntries(deps.db, clock(deps), deps.key, patientId);
  } catch (error) {
    console.error('[bot] varredura de pendentes falhou:', error);
  }
}

/** Fecha o registro: soma o dia, gera orientação e monta a resposta final. */
async function confirmedReply(
  deps: BotDeps,
  patientId: string,
  meal: Meal,
  extras: readonly (string | null)[],
): Promise<BotReply> {
  const now = clock(deps);
  const progress = await sumFoodLogForDay(deps.db, patientId, localDayISO(now, tz(deps)), tz(deps), deps.key);
  const orientation = await buildOrientation(deps.llm, progress);
  return {
    text: compose([
      `✅ Registrei no seu ${MEAL_LABELS[meal].toLowerCase()}.`,
      ...extras,
      formatProgress(progress),
      orientation,
      DISCLAIMER,
    ]),
  };
}

/**
 * O coração da Fase 2: com a refeição JÁ conhecida, grava direto; sem ela, guarda
 * o prato como PENDENTE e pergunta com botões.
 *
 * Gravar só depois da resposta (em vez de gravar com `meal` nulo e completar
 * depois) foi decisão de produto: um registro que já aparece no `/hoje` antes de
 * o paciente confirmar contradiz a própria pergunta.
 */
async function registerOrAsk(
  deps: BotDeps,
  patientId: string,
  chatId: string,
  input: FoodLogInput,
  meal: Meal | null,
  auditAction: string,
  preamble: readonly (string | null)[],
): Promise<BotReply> {
  if (meal) {
    await addFoodLogEntry(
      deps.db,
      patientId,
      { ...input, meal },
      deps.key,
      { action: auditAction, ...(input.modelVersion ? { modelVersion: input.modelVersion } : {}) },
    );
    return confirmedReply(deps, patientId, meal, preamble);
  }

  const now = clock(deps);
  const pendingId = await addPendingFoodEntry(
    deps.db,
    patientId,
    chatId,
    input,
    deps.key,
    pendingExpiresAt(now, tz(deps)),
  );
  const pendentes = await listPendingFoodEntries(deps.db, patientId, deps.key);
  const resumo =
    pendentes.length > 1
      ? describePending(pendentes.find((p) => p.id === pendingId) ?? pendentes[pendentes.length - 1]!, tz(deps))
      : undefined;

  return {
    text: compose([...preamble, askMealText(input.values, pendentes.length, resumo), DISCLAIMER]),
    buttons: mealButtons(pendingId),
  };
}

/**
 * Foto do prato → estimativa → PERGUNTA a refeição → registro auditado.
 * A legenda da foto (`caption`), se houver, orienta a identificação dos alimentos
 * e pode JÁ trazer a refeição ("jantar: frango grelhado").
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

  await flushExpired(deps, patientId);

  // A legenda pode já trazer a refeição ("jantar: frango"). O resto continua
  // servindo de dica para a visão identificar os alimentos.
  const { meal, rest } = extractLeadingMeal(caption ?? '');
  const dica = rest.trim() || undefined;

  // TETO DE PENDENTES: acima dele NÃO chamamos o estimador. A visão custa por
  // chamada, e acumular perguntas sem resposta é sinal de conversa travada —
  // não de uso normal. Lição do vazamento de custo de 2026-07-24.
  const abertos = await listPendingFoodEntries(deps.db, patientId, deps.key);
  if (!meal && abertos.length >= MAX_PENDING) {
    return {
      text:
        `Tenho ${abertos.length} registros esperando você dizer de que refeição foram. ` +
        'Me responda esses primeiro (é só tocar nos botões acima) que eu volto a estimar suas fotos.',
    };
  }

  const estimate = await deps.estimator.estimate(image, dica);
  const modelVersion = deps.estimator.modelVersion;

  return registerOrAsk(
    deps,
    patientId,
    chatId,
    {
      eatenAt: clock(deps),
      values: {
        ...estimate.values,
        confidence: estimate.confidence,
        ...(estimate.itemsLabel ? { itemsLabel: estimate.itemsLabel } : {}),
      },
      ...(photoRef ? { photoRef } : {}),
      ...(modelVersion ? { modelVersion } : {}),
    },
    meal,
    'telegram-bot',
    // A estimativa aparece ANTES da pergunta: o paciente precisa ver o que o bot
    // entendeu para poder corrigir, e não classificar às cegas.
    [formatEstimate(estimate), CORRECT_TIP],
  );
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

  await flushExpired(deps, patientId);

  const now = clock(deps);
  const dayISO = localDayISO(now, tz(deps));
  const progress = await sumFoodLogForDay(deps.db, patientId, dayISO, tz(deps), deps.key);
  const orientation = await buildOrientation(deps.llm, progress);

  // Sem isto, o paciente que mandou uma foto e não respondeu a pergunta vê um
  // /hoje que não bate com o que enviou, e conclui que o bot perdeu o registro.
  // Reenviamos os botões do pendente mais antigo para ele conseguir resolver.
  const pendentes = await listPendingFoodEntries(deps.db, patientId, deps.key);
  const alvo = pendentes[0];
  const avisoPendente = alvo
    ? `⏳ ${pendentes.length === 1 ? 'Tem 1 registro esperando' : `Tem ${pendentes.length} registros esperando`} ` +
      `você dizer a refeição — o ${describePending(alvo, tz(deps))}. Ele ainda NÃO entrou na conta acima.`
    : null;

  return {
    text: compose([formatProgress(progress), avisoPendente, orientation, DISCLAIMER]),
    ...(alvo ? { buttons: mealButtons(alvo.id) } : {}),
  };
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

const TEXT_LOG_HELP =
  'Diga o que você comeu e as quantidades. Ex.: /comi 100g de arroz, 150g de frango grelhado, 1 colher de azeite.';

/** Uma linha por item registrado, com os gramas que entraram na conta. */
function formatTextItems(mapped: readonly MappedItem[]): string {
  return mapped
    .filter((m) => m.nutrients !== null)
    .map((m) => {
      const grams = m.grams !== null ? `${m.grams} g` : '';
      const estimated = m.gramsEstimated ? ' (~estimada)' : '';
      const kcal = Math.round(m.nutrients?.kcal ?? 0);
      return `• ${m.item.food} ${grams}${estimated} — ~${kcal} kcal`;
    })
    .join('\n');
}

/** Uma linha por item que ficou de fora, com o motivo específico. */
function formatMisses(mapped: readonly MappedItem[]): string {
  return mapped
    .filter((m) => m.status === 'unmatched')
    .map((m) => `• ${m.item.food} — ${m.missReason ?? 'não encontrei esse alimento.'}`)
    .join('\n');
}

/**
 * Itens em que o alimento escolhido veio da busca por semelhança e ficou abaixo
 * do limiar de confiança. Mostrar O QUE foi entendido é o que permite o paciente
 * corrigir — sem isso ele só descobre o erro pelo total estranho no fim do dia.
 */
function formatUncertain(mapped: readonly MappedItem[]): string | null {
  const incertos = mapped.filter((m) => m.status === 'uncertain' && m.taco);
  if (incertos.length === 0) return null;
  const linhas = incertos.map((m) => `• "${m.item.food}" → entendi como *${m.taco!.description}*`).join('\n');
  return `🤔 Não tenho certeza destes:\n${linhas}\nSe não for isso, me diga o nome mais específico.`;
}

/**
 * `/comi <alimentos e quantidades>` — registro alimentar por TEXTO
 * (2026-07-24). Caminho 100% determinístico: parser + tabela TACO, SEM visão e
 * SEM LLM nos números. Conviver com a foto é de propósito — o paciente usa o
 * que for mais prático, e quando ele informa os gramas o único ponto de
 * incerteza que resta é o match na TACO (a foto chuta alimento E porção).
 */
export async function handleAte(deps: BotDeps, chatId: string, arg: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const raw = arg.trim();
  if (!raw) return { text: TEXT_LOG_HELP };

  await flushExpired(deps, patientId);

  // Atalho: "/comi almoço 100g de arroz" já diz a refeição. Perguntar de novo
  // seria ignorar o que o paciente acabou de falar.
  const { meal, rest } = extractLeadingMeal(raw);
  const text = rest.trim() || raw;

  const items = parseFoodText(text);
  if (items.length === 0) {
    return { text: `Não identifiquei alimentos nessa mensagem. ${TEXT_LOG_HELP}` };
  }

  const mapped = mapRecallToTaco(items);
  const computation = computeNutrition(mapped);
  if (computation.unmatched.length === items.length) {
    // Nada entrou na conta. Mostrar o MOTIVO de cada item, não uma recusa
    // genérica: "não tenho leite líquido com valor confiável" e "não conheço
    // esse alimento" pedem ações diferentes do paciente.
    return { text: `Não registrei nada:\n${formatMisses(mapped)}` };
  }

  const anyUncertain = mapped.some((m) => m.status === 'uncertain');
  const confidence: FoodConfidence =
    computation.unmatched.length > 0
      ? 'low'
      : computation.estimatedCount === 0 && !anyUncertain
        ? 'high'
        : 'medium';
  const itemsLabel = mapped
    .filter((m) => m.nutrients !== null)
    .map((m) => (m.grams !== null ? `${m.item.food} ${m.grams} g` : m.item.food))
    .join(', ')
    .slice(0, 200);
  // `tacoVersion` JÁ vem como "taco-4ed" — o template antigo produzia
  // "taco-taco-4ed". Agora a proveniência cita as DUAS tabelas, porque desde o
  // E16 um mesmo registro pode somar valor da TACO e valor de rótulo.
  const provenance = FOOD_TABLES_VERSION;

  const t = computation.totals;
  // A procedência fica VISÍVEL para o paciente — é o que sustenta a confiança no
  // número. Mas precisa ser exata: desde o E16 um mesmo total pode somar valor da
  // TACO e valor de rótulo (a TACO não tem suplemento nenhum), e dizer "pela
  // tabela TACO" nesse caso seria atribuir à TACO um número que não é dela.
  const usouRotulo = mapped.some((m) => m.taco?.source === 'nutrimed');
  const fonte = usouRotulo ? 'pela tabela TACO + rótulos' : 'pela tabela TACO';
  const total =
    `Total ${fonte}: ~${Math.round(t.kcal ?? 0)} kcal · ` +
    `P ${Math.round(t.protein ?? 0)} g · C ${Math.round(t.carbs ?? 0)} g · G ${Math.round(t.fat ?? 0)} g`;
  const estimatedWarning =
    computation.estimatedCount > 0
      ? `⚠️ Você não informou a quantidade de ${computation.estimatedCount} item(ns) — assumi uma porção ` +
        'padrão e marquei como estimada. Informar os gramas deixa a conta bem mais precisa.'
      : null;
  const unmatchedWarning =
    computation.unmatched.length > 0
      ? `❓ NÃO entraram na conta:\n${formatMisses(mapped)}`
      : null;

  return registerOrAsk(
    deps,
    patientId,
    chatId,
    {
      eatenAt: clock(deps),
      source: 'telegram-texto',
      values: {
        kcal: t.kcal ?? 0,
        protein: t.protein ?? 0,
        carbs: t.carbs ?? 0,
        fat: t.fat ?? 0,
        confidence,
        itemsLabel,
        ...(computation.estimatedCount > 0 ? { portionsEstimated: true } : {}),
        ...(computation.unmatched.length > 0
          ? { unmatchedItems: computation.unmatched.map((i) => i.food) }
          : {}),
      },
      modelVersion: provenance,
    },
    meal,
    'telegram-bot-texto',
    [
      `✍️ Entendi o que você digitou:\n${formatTextItems(mapped)}\n${total}`,
      formatUncertain(mapped),
      estimatedWarning,
      unmatchedWarning,
    ],
  );
}

/** Resposta comum a botão e comando, depois que a refeição foi resolvida. */
async function applyMeal(
  deps: BotDeps,
  patientId: string,
  pendingId: string,
  meal: Meal,
): Promise<BotReply> {
  const done = await confirmPendingFoodEntry(deps.db, patientId, pendingId, meal, deps.key);
  if (!done) {
    // Já consumido (duplo clique) ou expirado e varrido. Não é erro do paciente.
    return { text: 'Esse registro já foi confirmado. 👍', callbackAck: 'Já confirmado' };
  }
  const reply = await confirmedReply(deps, patientId, meal, []);
  return { ...reply, callbackAck: MEAL_LABELS[meal] };
}

/**
 * Toque no botão de refeição. O `callbackData` traz o id do pendente, então duas
 * perguntas abertas ao mesmo tempo não se confundem.
 */
export async function handleMealChoice(
  deps: BotDeps,
  chatId: string,
  callbackData: string,
): Promise<BotReply | null> {
  const choice = parseMealCallback(callbackData);
  if (!choice) return null; // botão de outra feature — não é nosso

  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const pendentes = await listPendingFoodEntries(deps.db, patientId, deps.key);
  const alvo = pendentes.find((p) => matchesPendingId(p.id, choice.pendingIdCompact));
  if (!alvo) {
    return {
      text: 'Esse registro já foi confirmado ou expirou. Se precisar, é só mandar de novo.',
      callbackAck: 'Registro não está mais pendente',
    };
  }
  return applyMeal(deps, patientId, alvo.id, choice.meal);
}

/**
 * `/refeicao <nome>` — fallback textual do botão. Existe para cliente antigo,
 * mensagem apagada e para quem prefere digitar. Aplica ao pendente MAIS ANTIGO.
 *
 * O bot NÃO aceita a refeição em texto solto (sem o comando): em grupo, com
 * privacy mode OFF, ele recebe toda a conversa, e "almoço" dito por outra pessoa
 * viraria resposta clínica do paciente.
 */
export async function handleMealCommand(deps: BotDeps, chatId: string, arg: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const meal = parseMeal(arg);
  if (!meal) {
    return { text: 'Não entendi a refeição. Use: /refeicao cafe | almoco | jantar | lanche.' };
  }

  const pendentes = await listPendingFoodEntries(deps.db, patientId, deps.key);
  const alvo = pendentes[0];
  if (!alvo) {
    return { text: 'Não tenho nenhum registro esperando refeição agora.' };
  }
  return applyMeal(deps, patientId, alvo.id, meal);
}

/**
 * `/comando` ou `/comando@NomeDoBot` (forma usada em grupos). Retorna o resto do
 * texto (argumento) se casar, `null` se não. O sufixo `@bot` é aceito com
 * qualquer nome — o Telegram só entrega ao bot os comandos endereçados a ele.
 */
function matchCommand(text: string, command: string): string | null {
  const m = new RegExp(`^\\/${command}(?:@\\w+)?\\b`, 'i').exec(text);
  return m ? text.slice(m[0].length).trim() : null;
}

/**
 * Dispatcher. Ordem importa: o toque em BOTÃO vem primeiro porque não tem texto
 * nem foto — se caísse depois, sairia pelo "não entendi".
 */
export async function handleUpdate(deps: BotDeps, update: BotUpdate): Promise<BotReply | null> {
  if (update.callbackData) return handleMealChoice(deps, update.chatId, update.callbackData);

  if (update.photo) return handlePhoto(deps, update.chatId, update.photo, update.photoRef, update.caption);

  const text = update.text?.trim();
  if (!text) return null;
  const start = matchCommand(text, 'start');
  if (start !== null) return handleStart(deps, update.chatId, start || undefined);
  if (matchCommand(text, 'hoje') !== null) return handleToday(deps, update.chatId);
  if (matchCommand(text, 'meta') !== null) return handleGoal(deps, update.chatId);
  const corrigir = matchCommand(text, 'corrigir');
  if (corrigir !== null) return handleCorrection(deps, update.chatId, corrigir);
  const refeicao = matchCommand(text, 'refeicao');
  if (refeicao !== null) return handleMealCommand(deps, update.chatId, refeicao);
  const comi = matchCommand(text, 'comi');
  if (comi !== null) return handleAte(deps, update.chatId, comi);
  return {
    text:
      'Não entendi. Envie a foto do seu prato ou use /comi para digitar o que comeu com as ' +
      'quantidades (ex.: /comi 100g de arroz). Também tenho /hoje (progresso), /meta, ' +
      '/refeicao (responde de que refeição foi) e /corrigir (ajusta o último prato). ' +
      'Se ainda não vinculou, use /start CÓDIGO.',
  };
}
