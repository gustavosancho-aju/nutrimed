import type { SqlExecutor } from '@nutrimed/db';
import {
  addFoodLogEntry,
  findLatestFoodLogEntry,
  updateFoodLogEntryValues,
  sumFoodLogForDay,
  loadCurrentNutritionGoal,
  addWaterLog,
  sumWaterForDay,
  addSleepEvent,
  findLastSleepSession,
  sleepTargetFromGoal,
  type DailyProgress,
  type WaterProgress,
  type SleepSession,
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

/**
 * Interpreta a quantidade de água informada (pedido do médico, 2026-07-20):
 * "500ml", "500 ml", "1.5l", "1 litro", "2 copos" (250ml/copo) ou só um
 * número (assume ml). Fora de uma faixa plausível (0–10000ml por registro)
 * ⇒ null — mesmo teto de `RANGES.waterMl` na UI do médico.
 */
function parseWaterMl(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  let ml: number | null = null;
  let m = /^(\d+(?:\.\d+)?)\s*(l|litro|litros)\b/.exec(t);
  if (m) ml = Number(m[1]) * 1000;
  if (ml === null) {
    m = /^(\d+(?:\.\d+)?)\s*copos?\b/.exec(t);
    if (m) ml = Number(m[1]) * 250;
  }
  if (ml === null) {
    m = /^(\d+(?:\.\d+)?)\s*ml\b/.exec(t);
    if (m) ml = Number(m[1]);
  }
  if (ml === null) {
    m = /^(\d+(?:\.\d+)?)$/.exec(t);
    if (m) ml = Number(m[1]);
  }
  if (ml === null || !Number.isFinite(ml) || ml <= 0 || ml > 10_000) return null;
  return Math.round(ml);
}

/** Horário local HH:MM informado pelo paciente (`/dormi 23:30`) — null se ausente/inválido. */
function parseTimeArg(arg: string | undefined): string | null {
  const t = arg?.trim();
  if (!t) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
}

/**
 * Resolve o instante do evento (deitar/acordar) a partir de um HH:MM local —
 * SEM depender do fuso do servidor (mesma aritmética de `localDayISO`). Se o
 * horário informado ainda não chegou hoje por mais de 2h, assume que é
 * referência à NOITE PASSADA (o paciente avisa de manhã que dormiu às 23:30
 * ontem). Sem HH:MM ⇒ usa `now` (o instante em que a mensagem chegou).
 */
function resolveEventTime(now: Date, hhmm: string | null, tzOffsetMinutes: number): Date {
  if (!hhmm) return now;
  const [hh, mm] = hhmm.split(':').map(Number);
  const localNowMs = now.getTime() + tzOffsetMinutes * 60_000;
  const localNow = new Date(localNowMs);
  let localCandidateMs = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), hh, mm);
  if (localCandidateMs - localNowMs > 2 * 60 * 60 * 1000) {
    localCandidateMs -= 24 * 60 * 60 * 1000;
  }
  return new Date(localCandidateMs - tzOffsetMinutes * 60_000);
}

const SLEEP_QUALITY_LABEL: Record<SleepSession['quality'], string> = {
  curta: 'curta ⚠️',
  boa: 'boa ✅',
  longa: 'longa',
};

/** Rótulo simples (sem emoji) — usado no resumo compacto de `/hoje`. */
const SLEEP_QUALITY_PLAIN: Record<SleepSession['quality'], string> = {
  curta: 'curta',
  boa: 'boa',
  longa: 'longa',
};

function formatSleepDuration(session: SleepSession): string {
  const hours = Math.floor(session.durationMinutes / 60);
  const mins = Math.round(session.durationMinutes % 60);
  return `${hours}h${String(mins).padStart(2, '0')}`;
}

/** Resumo de água p/ `/hoje` — omitido se não há nem consumo nem meta (evita ruído). */
function formatWaterSummary(p: WaterProgress): string | null {
  if (p.consumedMl === 0 && p.goalMl === null) return null;
  if (p.goalMl === null) return `💧 Água hoje: ${p.consumedMl} ml.`;
  const faltam = Math.max(0, Math.round(p.remainingMl ?? 0));
  return `💧 Água hoje: ${p.consumedMl}/${p.goalMl} ml (faltam ${faltam}).`;
}

/** Resumo de sono p/ `/hoje` — omitido sem uma sessão pareada (deitar+acordar). */
function formatSleepSummary(session: SleepSession | null): string | null {
  if (!session) return null;
  return `😴 Última noite: ${formatSleepDuration(session)} (${SLEEP_QUALITY_PLAIN[session.quality]}).`;
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
        'mais precisa. Também tenho /agua para água, /dormi e /acordei para o sono, /hoje para o ' +
        'progresso do dia, /meta para suas metas e /corrigir se eu identificar algo errado.',
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
  const dayISO = localDayISO(now, tz(deps));
  const progress = await sumFoodLogForDay(deps.db, patientId, dayISO, tz(deps), deps.key);
  const water = await sumWaterForDay(deps.db, patientId, dayISO, tz(deps), deps.key);
  const goal = await loadCurrentNutritionGoal(deps.db, patientId, deps.key, dayISO);
  const sleep = await findLastSleepSession(deps.db, patientId, deps.key, sleepTargetFromGoal(goal?.values));
  const orientation = await buildOrientation(deps.llm, progress);
  return {
    text: compose([
      formatProgress(progress),
      formatWaterSummary(water),
      formatSleepSummary(sleep),
      orientation,
      DISCLAIMER,
    ]),
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

  const text = arg.trim();
  if (!text) return { text: TEXT_LOG_HELP };

  const items = parseFoodText(text);
  if (items.length === 0) {
    return { text: `Não identifiquei alimentos nessa mensagem. ${TEXT_LOG_HELP}` };
  }

  const mapped = mapRecallToTaco(items);
  const computation = computeNutrition(mapped);
  if (computation.unmatched.length === items.length) {
    return {
      text:
        'Não encontrei esses alimentos na tabela TACO, então não registrei nada. Tente nomes mais ' +
        'simples (ex.: "arroz branco cozido", "frango grelhado") ou envie a foto do prato.',
    };
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
  const provenance = `taco-${computation.tacoVersion}`;

  const now = clock(deps);
  await addFoodLogEntry(
    deps.db,
    patientId,
    {
      eatenAt: now,
      source: 'telegram-texto',
      values: {
        kcal: computation.totals.kcal ?? 0,
        protein: computation.totals.protein ?? 0,
        carbs: computation.totals.carbs ?? 0,
        fat: computation.totals.fat ?? 0,
        confidence,
        itemsLabel,
        ...(computation.estimatedCount > 0 ? { portionsEstimated: true } : {}),
        ...(computation.unmatched.length > 0
          ? { unmatchedItems: computation.unmatched.map((i) => i.food) }
          : {}),
      },
      modelVersion: provenance,
    },
    deps.key,
    { action: 'telegram-bot-texto', modelVersion: provenance },
  );

  const t = computation.totals;
  const total =
    `Total pela tabela TACO: ~${Math.round(t.kcal ?? 0)} kcal · ` +
    `P ${Math.round(t.protein ?? 0)} g · C ${Math.round(t.carbs ?? 0)} g · G ${Math.round(t.fat ?? 0)} g`;
  const estimatedWarning =
    computation.estimatedCount > 0
      ? `⚠️ Você não informou a quantidade de ${computation.estimatedCount} item(ns) — assumi uma porção ` +
        'padrão e marquei como estimada. Informar os gramas deixa a conta bem mais precisa.'
      : null;
  const unmatchedWarning =
    computation.unmatched.length > 0
      ? `❓ Não encontrei na tabela TACO: ${computation.unmatched.map((i) => i.food).join(', ')} — ` +
        'esses itens NÃO entraram na conta.'
      : null;

  const progress = await sumFoodLogForDay(deps.db, patientId, localDayISO(now, tz(deps)), tz(deps), deps.key);
  const orientation = await buildOrientation(deps.llm, progress);
  return {
    text: compose([
      `✍️ Registrei o que você digitou:\n${formatTextItems(mapped)}\n${total}`,
      estimatedWarning,
      unmatchedWarning,
      formatProgress(progress),
      orientation,
      DISCLAIMER,
    ]),
  };
}

/**
 * `/agua <quantidade>` — registra água consumida (pedido do médico,
 * 2026-07-20). Sem estimativa por IA: o paciente informa o valor, o CÓDIGO
 * soma e compara com a meta do nutricionista (quando houver).
 */
export async function handleWater(deps: BotDeps, chatId: string, arg: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const ml = parseWaterMl(arg);
  if (ml === null) {
    return {
      text: 'Não entendi a quantidade. Use /agua 500ml, /agua 2 copos ou /agua 1 litro.',
    };
  }

  const now = clock(deps);
  await addWaterLog(deps.db, patientId, ml, now, deps.key, { action: 'telegram-bot' });
  const progress = await sumWaterForDay(deps.db, patientId, localDayISO(now, tz(deps)), tz(deps), deps.key);
  const goalLine =
    progress.goalMl === null
      ? `Hoje: ${progress.consumedMl} ml. Seu nutricionista ainda não definiu uma meta de água.`
      : `Hoje: ${progress.consumedMl}/${progress.goalMl} ml (faltam ${Math.max(0, Math.round(progress.remainingMl ?? 0))}).`;
  return { text: compose([`💧 +${ml} ml registrados.`, goalLine]) };
}

/** `/dormi [HH:MM]` — registra a hora de deitar (sem argumento ⇒ agora). */
export async function handleSleepStart(deps: BotDeps, chatId: string, arg?: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const raw = arg?.trim();
  const hhmm = parseTimeArg(raw);
  if (raw && !hhmm) {
    return { text: 'Não entendi o horário. Use /dormi HH:MM (ex.: /dormi 23:30) ou só /dormi para registrar agora.' };
  }
  const at = resolveEventTime(clock(deps), hhmm, tz(deps));
  await addSleepEvent(deps.db, patientId, 'sleep_start', at, deps.key, { action: 'telegram-bot' });
  return { text: `😴 Hora de dormir registrada${hhmm ? ` (${hhmm})` : ''}. Bom descanso! Use /acordei ao levantar.` };
}

/** `/acordei [HH:MM]` — registra a hora de acordar e calcula a duração da noite. */
export async function handleSleepEnd(deps: BotDeps, chatId: string, arg?: string): Promise<BotReply> {
  if (!(await isChannelAuthorized(deps.db, chatId))) return { text: NEEDS_PAIRING };
  const patientId = await resolvePatientByChat(deps.db, chatId);
  if (!patientId) return { text: NEEDS_PAIRING };

  const raw = arg?.trim();
  const hhmm = parseTimeArg(raw);
  if (raw && !hhmm) {
    return { text: 'Não entendi o horário. Use /acordei HH:MM (ex.: /acordei 07:00) ou só /acordei para registrar agora.' };
  }
  const at = resolveEventTime(clock(deps), hhmm, tz(deps));
  await addSleepEvent(deps.db, patientId, 'sleep_end', at, deps.key, { action: 'telegram-bot' });

  const goal = await loadCurrentNutritionGoal(deps.db, patientId, deps.key, localDayISO(at, tz(deps)));
  const session = await findLastSleepSession(deps.db, patientId, deps.key, sleepTargetFromGoal(goal?.values));
  if (!session) {
    return {
      text: '☀️ Bom dia! Registrei que você acordou — não encontrei um "/dormi" correspondente para calcular a duração.',
    };
  }
  return {
    text: `☀️ Bom dia! Você dormiu ${formatSleepDuration(session)} — duração ${SLEEP_QUALITY_LABEL[session.quality]}.`,
  };
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

/** Dispatcher: foto → estimativa; `/start`/`/hoje`/`/meta`/`/corrigir`/`/agua`/`/dormi`/`/acordei`; senão ajuda. */
export async function handleUpdate(deps: BotDeps, update: BotUpdate): Promise<BotReply | null> {
  if (update.photo) return handlePhoto(deps, update.chatId, update.photo, update.photoRef, update.caption);

  const text = update.text?.trim();
  if (!text) return null;
  const start = matchCommand(text, 'start');
  if (start !== null) return handleStart(deps, update.chatId, start || undefined);
  if (matchCommand(text, 'hoje') !== null) return handleToday(deps, update.chatId);
  if (matchCommand(text, 'meta') !== null) return handleGoal(deps, update.chatId);
  const corrigir = matchCommand(text, 'corrigir');
  if (corrigir !== null) return handleCorrection(deps, update.chatId, corrigir);
  const comi = matchCommand(text, 'comi');
  if (comi !== null) return handleAte(deps, update.chatId, comi);
  const agua = matchCommand(text, 'agua');
  if (agua !== null) return handleWater(deps, update.chatId, agua);
  const dormi = matchCommand(text, 'dormi');
  if (dormi !== null) return handleSleepStart(deps, update.chatId, dormi || undefined);
  const acordei = matchCommand(text, 'acordei');
  if (acordei !== null) return handleSleepEnd(deps, update.chatId, acordei || undefined);
  return {
    text:
      'Não entendi. Envie a foto do seu prato ou use /comi para digitar o que comeu com as ' +
      'quantidades (ex.: /comi 100g de arroz). Também tenho /hoje, /meta, /corrigir (ajusta o ' +
      'último prato), /agua, /dormi e /acordei. Se ainda não vinculou, use /start CÓDIGO.',
  };
}
