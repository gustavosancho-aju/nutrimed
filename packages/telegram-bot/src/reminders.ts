import {
  EXPECTED_MEALS,
  MEAL_LABELS,
  claimReminder,
  listMealCoverageForDay,
  listPendingFoodEntries,
  loadCurrentNutritionGoal,
  sumFoodLogForDay,
  type DayMealCoverage,
  type Meal,
} from '@nutrimed/patients';
import type { BotButton, BotDeps, BotReply } from './bot';
import { describePending, mealButtons } from './meal';

/**
 * Lembretes PROATIVOS (E16 Fase 3) — o bot deixa de ser só reativo.
 *
 * Este módulo PLANEJA e decide; ele não conhece o Telegram. O envio é injetado
 * pelo transporte, o que mantém a decisão testável sem rede (mesma divisão que
 * sustenta o `bot.ts`).
 *
 * ┌─ REGRAS DA COPY ─────────────────────────────────────────────────────────┐
 * │ Existem porque a formulação original ("sua alimentação está fraca") é     │
 * │ (a) juízo sobre a PESSOA, (b) afirmação que o sistema não tem base para   │
 * │ fazer — ele conhece o que foi REGISTRADO, não o que foi comido — e (c)    │
 * │ prescritiva por implicação: se está "fraca", a ação corretiva está        │
 * │ subentendida. Isso encosta no CJ-4 e na postura "IA assiste, médico       │
 * │ decide". As regras viram teste em `reminders.test.ts`:                    │
 * │                                                                          │
 * │  1. O sujeito é o REGISTRO, nunca o paciente. "não recebi o registro do   │
 * │     café da manhã", jamais "você não tomou café" — o bot literalmente não │
 * │     sabe, e essa humildade é a defesa mais forte que temos.               │
 * │  2. Números, não adjetivos. "~700 das ~2000 kcal", nunca "pouco".         │
 * │  3. A meta é do NUTRICIONISTA, nunca do bot.                              │
 * │  4. Zero prescrição. Nunca "coma mais proteína". O convite é sempre a     │
 * │     REGISTRAR, não a comer.                                               │
 * │  5. Nenhuma culpa, nenhuma gamificação: sem streak, sem ❌, sem ⚠️.        │
 * │  6. Saída visível (/silenciar) e disclaimer em toda mensagem proativa.    │
 * │                                                                          │
 * │ E SEM LLM. `buildOrientation` é tolerável na resposta REATIVA (o paciente │
 * │ iniciou); numa mensagem proativa e não supervisionada, deixar o modelo    │
 * │ escrever é entregar ao acaso a fronteira do CJ-4. Template fixo também    │
 * │ torna a blacklist um teste real, e não um sorteio.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

export type ReminderKind = 'abaixo-da-meta-16h' | 'refeicao-faltante-22h';

export interface PlannedReminder {
  readonly patientId: string;
  readonly chatId: string;
  readonly kind: ReminderKind;
  readonly localDay: string;
  readonly text: string;
  readonly buttons?: readonly (readonly BotButton[])[];
  /** Vai para `patient_reminder_log.detail` — no máximo o rótulo da refeição. */
  readonly detail?: string;
}

/** Minutos desde a meia-noite LOCAL. Injetável nos testes via `windows`. */
export interface ReminderWindows {
  readonly belowGoal: readonly [number, number];
  readonly missingMeal: readonly [number, number];
}

export const DEFAULT_WINDOWS: ReminderWindows = {
  // JANELA, não instante. Se o tick das 16:00 caiu no meio de um deploy
  // (rolling, wait_timeout 5m), o das 16:20 ainda entrega. Passada a janela,
  // NÃO entrega mais — lembrete das 16h chegando às 19h é pior que não chegar.
  belowGoal: [16 * 60, 16 * 60 + 59],
  missingMeal: [21 * 60 + 45, 22 * 60 + 30],
};

/**
 * Piso rígido de horário, NÃO configurável. As janelas acima já vivem dentro
 * dele, então isto é rede de segurança contra bug de fuso — não uma feature.
 */
export const QUIET_HOURS = { from: 7 * 60, to: 22 * 60 + 30 } as const;

/**
 * Abaixo de METADE da meta às 16h. Constante exportada e testável em vez de
 * número mágico solto no meio do código.
 */
export const BELOW_GOAL_RATIO = 0.5;

const DISCLAIMER =
  'ℹ️ Estimativa automática e aproximada — não substitui a orientação do seu nutricionista.';
const OPT_OUT = 'Para não receber estes lembretes, responda /silenciar.';

export interface ReminderDeps extends BotDeps {
  readonly windows?: ReminderWindows;
}

function minutesOfLocalDay(now: Date, tzOffsetMinutes: number): number {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function localDayISO(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function inWindow(minutes: number, [from, to]: readonly [number, number]): boolean {
  return minutes >= from && minutes <= to;
}

/** Refeições esperadas que não têm registro. Lanche nunca é cobrado. */
export function missingMeals(covered: readonly Meal[]): readonly Meal[] {
  return EXPECTED_MEALS.filter((m) => !covered.includes(m));
}

// ── Textos ───────────────────────────────────────────────────────────────────

function textBelowGoal(consumedKcal: number, goalKcal: number): string {
  return [
    `Oi! Até agora recebi registros somando ~${Math.round(consumedKcal)} kcal de hoje. ` +
      `A meta que seu nutricionista definiu para o dia é ~${Math.round(goalKcal)} kcal.`,
    'Se você comeu e ainda não registrou, é só me mandar a foto do prato ou usar /comi.',
    DISCLAIMER,
    OPT_OUT,
  ].join('\n\n');
}

function textNoRecords(): string {
  return [
    'Oi! Hoje ainda não recebi nenhum registro seu.',
    'Se quiser registrar o que comeu, é só mandar a foto do prato ou usar /comi.',
    OPT_OUT,
  ].join('\n\n');
}

function textMissingMeal(meal: Meal): string {
  return [
    `Antes de encerrar o dia: não recebi o registro do ${MEAL_LABELS[meal].toLowerCase()} de hoje.`,
    'Se quiser registrar, é só mandar a foto do prato ou usar /comi.',
    OPT_OUT,
  ].join('\n\n');
}

function textNothingToday(): string {
  return ['Antes de encerrar o dia: hoje não recebi registros seus.', OPT_OUT].join('\n\n');
}

function textPendingMeal(resumo: string): string {
  return [
    `Ficou faltando me dizer de que refeição foi o prato ${resumo}.`,
    OPT_OUT,
  ].join('\n\n');
}

// ── Planejamento ─────────────────────────────────────────────────────────────

/**
 * Decide o que DEVERIA sair agora. Lê o banco, mas **não envia nada e não marca
 * nada** — é o que torna o comportamento testável sem rede e sem efeito.
 */
export async function planReminders(
  deps: ReminderDeps,
  now: Date,
): Promise<readonly PlannedReminder[]> {
  const tz = deps.tzOffsetMinutes ?? -180;
  const minutes = minutesOfLocalDay(now, tz);
  const windows = deps.windows ?? DEFAULT_WINDOWS;

  // Piso rígido: nada proativo fora da janela de silêncio, jamais.
  if (minutes < QUIET_HOURS.from || minutes > QUIET_HOURS.to) return [];

  const isBelowGoal = inWindow(minutes, windows.belowGoal);
  const isMissingMeal = inWindow(minutes, windows.missingMeal);
  // Fora das janelas o tick não faz consulta nenhuma — é o que o torna barato
  // o suficiente para rodar a cada 5 minutos.
  if (!isBelowGoal && !isMissingMeal) return [];

  const day = localDayISO(now, tz);
  const coverage = await listMealCoverageForDay(deps.db, day, tz);

  const out: PlannedReminder[] = [];
  for (const c of coverage) {
    const planned = isBelowGoal
      ? await planBelowGoal(deps, c, day, tz)
      : await planMissingMeal(deps, c, day, tz);
    if (planned) out.push(planned);
  }
  return out;
}

async function planBelowGoal(
  deps: ReminderDeps,
  c: DayMealCoverage,
  day: string,
  tz: number,
): Promise<PlannedReminder | null> {
  // SEM META, nenhum alerta. Não existe "abaixo" sem alvo, e inventar um alvo
  // seria exatamente o que o ADR-015 proíbe.
  const goal = await loadCurrentNutritionGoal(deps.db, c.patientId, deps.key, day);
  if (!goal) return null;

  const base = { patientId: c.patientId, chatId: c.chatId, kind: 'abaixo-da-meta-16h' as const, localDay: day };

  if (c.entryCount === 0) {
    // Mensagem MAIS LEVE para quem não registrou nada. Listar o que falta para
    // quem não registrou nada lê como sermão.
    return { ...base, text: textNoRecords() };
  }

  const progress = await sumFoodLogForDay(deps.db, c.patientId, day, tz, deps.key);
  if (progress.consumed.kcal >= goal.values.kcal * BELOW_GOAL_RATIO) return null;
  return { ...base, text: textBelowGoal(progress.consumed.kcal, goal.values.kcal) };
}

async function planMissingMeal(
  deps: ReminderDeps,
  c: DayMealCoverage,
  day: string,
  tz: number,
): Promise<PlannedReminder | null> {
  const base = { patientId: c.patientId, chatId: c.chatId, kind: 'refeicao-faltante-22h' as const, localDay: day };

  // PRIORIDADE ao pendente: é mais preciso (o prato já foi estimado e PAGO), e
  // resolve a lacuna sem o paciente digitar nada de novo.
  const pendentes = await listPendingFoodEntries(deps.db, c.patientId, deps.key);
  const pendente = pendentes[0];
  if (pendente) {
    return {
      ...base,
      text: textPendingMeal(describePending(pendente, tz)),
      buttons: mealButtons(pendente.id),
      detail: 'pendente',
    };
  }

  if (c.entryCount === 0) return { ...base, text: textNothingToday(), detail: 'sem-registros' };

  const faltando = missingMeals(c.meals);
  if (faltando.length === 0) return null;
  // Cita NO MÁXIMO UMA, a mais antiga na ordem do dia. Uma lista de faltas é um
  // boletim de notas, e não é isso que o produto quer ser.
  const alvo = faltando[0]!;
  return { ...base, text: textMissingMeal(alvo), detail: alvo };
}

// ── Execução ─────────────────────────────────────────────────────────────────

export type PushFn = (
  chatId: string,
  text: string,
  buttons?: readonly (readonly BotButton[])[],
) => Promise<boolean>;

/**
 * Tick completo: planeja → CLAIM atômico → envia. Nunca lança; devolve o que
 * saiu de fato.
 *
 * O claim vem ANTES do envio de propósito (ver migration 0028): entrega "no
 * máximo uma vez". Se o `push` falhar, liberamos o claim para o próximo tick da
 * MESMA janela tentar de novo — sem atravessar a janela, o que evitaria o
 * lembrete das 16h chegando de noite.
 */
export async function runReminderTick(
  deps: ReminderDeps,
  push: PushFn,
  now: Date,
  onBlocked?: (patientId: string) => Promise<void>,
): Promise<readonly PlannedReminder[]> {
  let planned: readonly PlannedReminder[] = [];
  try {
    planned = await planReminders(deps, now);
  } catch (error) {
    console.error('[lembretes] falha ao planejar:', error);
    return [];
  }

  const enviados: PlannedReminder[] = [];
  for (const p of planned) {
    try {
      const reservado = await claimReminder(deps.db, p.patientId, p.kind, p.localDay, p.chatId, p.detail);
      if (!reservado) continue; // já mandamos hoje

      const ok = await push(p.chatId, p.text, p.buttons);
      if (ok) {
        enviados.push(p);
      } else {
        // Falha de envio: o paciente pode ter bloqueado o bot (403), o que é
        // revogação de fato — quem trata é o transporte, via onBlocked.
        await onBlocked?.(p.patientId);
      }
    } catch (error) {
      console.error('[lembretes] falha ao enviar:', error);
    }
  }
  return enviados;
}

/** Só para o transporte montar a resposta de `/silenciar` e `/lembretes`. */
export const REMINDER_TEXTS = {
  silenced:
    '🔕 Pronto, não te mando mais lembretes. Você continua podendo registrar suas refeições ' +
    'normalmente, e pode religar quando quiser com /lembretes.',
  resumed:
    '🔔 Lembretes religados. Vou te avisar à tarde se o registro do dia estiver bem abaixo da ' +
    'meta, e à noite se faltar alguma refeição. Para desligar de novo, /silenciar.',
} as const;

export type { BotReply };
