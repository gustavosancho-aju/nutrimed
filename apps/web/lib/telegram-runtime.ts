import 'server-only';
import { loadEncryptionKey } from '@nutrimed/crypto';
import { createFoodEstimator, type FoodImageInput } from '@nutrimed/food-vision';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import type { ILlmProvider } from '@nutrimed/providers';
import { handleUpdate, type BotButton, type BotDeps, type BotUpdate } from '@nutrimed/telegram-bot';
import { TelegramTelemetry } from '@nutrimed/telemetry';
import { getDb } from './db';
import { startReminderScheduler } from './reminder-scheduler';

/**
 * Runtime do bot de Telegram no processo do Next (E12 — 12.7).
 *
 * Transporte via `fetch` puro à Bot API (sem SDK — mesmo padrão de
 * `@nutrimed/llm-anthropic`/`lab-import`/`food-vision`). A LÓGICA é do
 * `@nutrimed/telegram-bot` (12.6/12.8); aqui só traduzimos Telegram↔lógica.
 *
 * - Dev (`TELEGRAM_MODE=polling`): long-polling (getUpdates) num loop de fundo.
 * - Prod (webhook): `setWebhook` no boot; o route handler processa cada update.
 * Sem `TELEGRAM_BOT_TOKEN` ⇒ runtime `null` (canal desligado — degradação).
 *
 * Singleton em globalThis (resiliente ao HMR do Next), igual ao board-runtime.
 * ADR-010: um processo, estado em memória, sem nova porta (webhook entra na 3000).
 */

const TELEGRAM_API = 'https://api.telegram.org';

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}
interface TgPhotoSize {
  file_id: string;
}
interface TgMessage {
  message_id?: number;
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
}
/**
 * Toque em botão inline. É um tipo de update DIFERENTE de `message` — antes da
 * Fase 2 ele caía no chão em silêncio aqui, e o cliente do Telegram deixava o
 * botão "girando" para sempre, porque ninguém chamava `answerCallbackQuery`.
 */
interface TgCallbackQuery {
  id: string;
  data?: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number; type?: string } };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
interface TgFile {
  file_path?: string;
}

export interface TelegramRuntime {
  readonly secretToken?: string;
  /** Telemetria do canal (custo de visão, fotos, pacientes ativos — NFR7/NFR9). */
  readonly telemetry: TelegramTelemetry;
  /** Processa um update cru da Bot API (usado pelo webhook e pelo polling). */
  process(update: unknown): Promise<void>;
  /**
   * Envio ATIVO — mensagem que o bot INICIA, sem o paciente ter escrito. Só o
   * agendador de lembretes (Fase 3) usa. Devolve `false` em falha para o
   * chamador decidir (um 403 significa que o paciente bloqueou o bot, o que é
   * revogação de fato e precisa desligar os lembretes dele).
   */
  push(chatId: string, text: string, buttons?: readonly (readonly BotButton[])[]): Promise<boolean>;
}

const BR_TZ = -180; // offset do fuso BR em minutos (local = UTC + offset)

/** Dia local atual (YYYY-MM-DD) para as métricas por dia. */
function localDay(): string {
  return new Date(Date.now() + BR_TZ * 60_000).toISOString().slice(0, 10);
}

const globalForTg = globalThis as unknown as {
  __nutrimedTelegram?: Promise<TelegramRuntime | null>;
};

async function tgCall<T>(token: string, method: string, body: unknown): Promise<TgResponse<T>> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as TgResponse<T>;
}

/**
 * Envia mensagem, opcionalmente com botões inline. Devolve `ok` da Bot API —
 * antes esta função ignorava a resposta por completo, então um chat bloqueado
 * pelo paciente (403 "bot was blocked by the user") passava despercebido. Para
 * o envio ATIVO (lembretes) isso importa: bloqueio é revogação de fato.
 */
async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  buttons?: readonly (readonly BotButton[])[],
): Promise<boolean> {
  const res = await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    ...(buttons && buttons.length > 0
      ? {
          reply_markup: {
            inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.label, callback_data: b.data }))),
          },
        }
      : {}),
  });
  if (!res.ok) console.error('[telegram] sendMessage falhou:', JSON.stringify(res.description ?? '')); // valor remoto: nunca interpolar cru
  return res.ok;
}

/**
 * OBRIGATÓRIO após um `callback_query`: sem isto o cliente do Telegram mantém o
 * botão em estado de carregamento até dar timeout, e o paciente acha que travou.
 */
async function answerCallbackQuery(token: string, callbackId: string, text?: string): Promise<void> {
  await tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
  }).catch(() => undefined);
}

/** Remove os botões da mensagem já respondida — evita segundo toque no mesmo. */
async function clearButtons(token: string, chatId: string, messageId: number): Promise<void> {
  await tgCall(token, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

async function downloadPhoto(token: string, fileId: string): Promise<FoodImageInput> {
  const info = await tgCall<TgFile>(token, 'getFile', { file_id: fileId });
  const filePath = info.result?.file_path;
  if (!filePath) throw new Error('getFile sem file_path');
  const res = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mediaType: 'image/jpeg' };
}

function llmFromEnv(): ILlmProvider | null {
  // Orientação (12.8) só com LLM real; sem key ⇒ null (feedback factual).
  return process.env.ANTHROPIC_API_KEY
    ? new AnthropicLlmProvider({ apiKey: process.env.ANTHROPIC_API_KEY, personaId: 'aurelio' })
    : null;
}

async function buildDeps(token: string, telemetry: TelegramTelemetry): Promise<BotDeps> {
  return {
    db: await getDb(),
    key: loadEncryptionKey(),
    estimator: createFoodEstimator(process.env, {
      onUsage: (u) => telemetry.visionUsage(u.inputTokens, u.outputTokens),
    }),
    llm: llmFromEnv(),
    // /corrigir reestima a MESMA foto: re-download pelo file_id salvo (photoRef).
    downloadPhoto: (photoRef) => downloadPhoto(token, photoRef),
    tzOffsetMinutes: BR_TZ,
  };
}

/** Traduz o update do Telegram → lógica pura → resposta, e responde ao chat. */
async function processUpdate(
  token: string,
  deps: BotDeps,
  telemetry: TelegramTelemetry,
  raw: unknown,
): Promise<void> {
  const update = raw as TgUpdate;

  // Toque em botão inline. Vem ANTES da mensagem porque é outro tipo de update:
  // `callback_query` não tem `.message` do remetente, tem a mensagem ONDE está o
  // botão. Responder o callback é obrigatório (ver answerCallbackQuery).
  const cb = update.callback_query;
  if (cb) {
    const chatId = String(cb.message?.chat.id ?? '');
    if (!chatId) return;
    try {
      const reply = await handleUpdate(deps, {
        chatId,
        callbackData: cb.data,
        callbackId: cb.id,
        fromId: String(cb.from.id),
        ...(cb.message ? { messageId: cb.message.message_id } : {}),
        ...(cb.message?.chat.type ? { chatType: cb.message.chat.type as BotUpdate['chatType'] } : {}),
      });
      await answerCallbackQuery(token, cb.id, reply?.callbackAck);
      if (cb.message) await clearButtons(token, chatId, cb.message.message_id);
      if (reply) await sendMessage(token, chatId, reply.text, reply.buttons);
    } catch (error) {
      console.error('[telegram] falha ao processar callback:', error);
      await answerCallbackQuery(token, cb.id); // solta o botão mesmo em erro
    }
    return;
  }

  const msg = update.message ?? update.edited_message;
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const chatType = msg.chat.type as BotUpdate['chatType'];
  try {
    // TUDO passa pelo dispatcher — inclusive a foto. Antes `handlePhoto` era
    // chamado direto daqui, pulando o `handleUpdate`: qualquer estado colocado
    // no dispatcher funcionaria nos testes e NÃO em produção.
    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1]!;
      const image = await downloadPhoto(token, largest.file_id);
      const reply = await handleUpdate(deps, {
        chatId,
        photo: image,
        photoRef: largest.file_id,
        ...(msg.caption !== undefined ? { caption: msg.caption } : {}),
        ...(chatType ? { chatType } : {}),
      });
      telemetry.photoLogged(chatId, localDay());
      console.log(
        `[telegram] foto processada — pacientes ativos: ${telemetry.report().activePatients}, ` +
          `custo de visão acumulado ~US$${telemetry.visionUsd().toFixed(4)}`,
      );
      if (reply) await sendMessage(token, chatId, reply.text, reply.buttons);
      return;
    }
    if (typeof msg.text === 'string') {
      const reply = await handleUpdate(deps, {
        chatId,
        text: msg.text,
        ...(chatType ? { chatType } : {}),
      });
      if (reply) await sendMessage(token, chatId, reply.text, reply.buttons);
    }
  } catch (error) {
    console.error('[telegram] falha ao processar update:', error);
    // Não relança: o webhook responde 200 e o polling segue (sem retry-storm).
  }
}

/** Loop de long-polling (dev). Não-bloqueante: chamado com `void`. */
async function pollLoop(token: string, deps: BotDeps, telemetry: TelegramTelemetry): Promise<void> {
  // GUARDA REAL do incidente 2026-07-02: se o token já tem webhook registrado,
  // ele está em uso por um ambiente webhook (produção) — polling local com
  // esse token faria deleteWebhook e derrubaria o bot em prod. RECUSA.
  const info = await tgCall<{ url?: string }>(token, 'getWebhookInfo', {}).catch(() => null);
  const webhookUrl = info?.result?.url;
  if (webhookUrl) {
    // JSON.stringify: valor vem de resposta remota — nunca interpolar cru em log
    console.error(
      `[telegram] long-polling RECUSADO: este token tem webhook ativo (${JSON.stringify(webhookUrl)}) — ` +
        'provavelmente é o token de PRODUÇÃO. Use um bot de teste do @BotFather para dev.',
    );
    return;
  }
  await tgCall(token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => undefined);
  let offset = 0;
  for (;;) {
    try {
      // allowed_updates explícito, igual ao setWebhook: é no polling que os
      // botões são testados em dev, então ele não pode ficar de fora.
      const res = await tgCall<TgUpdate[]>(token, 'getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      });
      for (const update of res.result ?? []) {
        offset = update.update_id + 1;
        await processUpdate(token, deps, telemetry, update);
      }
    } catch (error) {
      console.error('[telegram] getUpdates falhou; retry em 3s:', error);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function init(): Promise<TelegramRuntime | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null; // canal desligado (degradação graciosa)

  const telemetry = new TelegramTelemetry();
  const deps = await buildDeps(token, telemetry);
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  const mode = process.env.TELEGRAM_MODE ?? (process.env.NODE_ENV === 'production' ? 'webhook' : 'polling');

  if (mode === 'polling') {
    // GUARDA: long-polling chama deleteWebhook — com o token de PROD isso
    // derruba o webhook de produção (lição paga em 2026-07-02). Em produção,
    // polling NUNCA liga; para dev do bot, use um bot de teste do @BotFather.
    if (process.env.NODE_ENV === 'production') {
      console.error('[telegram] TELEGRAM_MODE=polling IGNORADO em NODE_ENV=production — use webhook.');
      return {
        secretToken,
        telemetry,
        process: (update: unknown) => processUpdate(token, deps, telemetry, update),
        push: (chatId: string, text: string, buttons?: readonly (readonly BotButton[])[]) =>
          sendMessage(token, chatId, text, buttons),
      };
    }
    void pollLoop(token, deps, telemetry);
    console.log('[telegram] long-polling iniciado (dev).');
  } else {
    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (base) {
      await tgCall(token, 'setWebhook', {
        url: `${base}/api/telegram/webhook`,
        // Explícito: o default da Bot API já inclui callback_query, mas depender
        // de default de terceiro para uma feature nova é dívida silenciosa — se
        // o default mudar, os botões param de responder sem erro nenhum.
        allowed_updates: ['message', 'edited_message', 'callback_query'],
        ...(secretToken ? { secret_token: secretToken } : {}),
      });
      console.log('[telegram] webhook registrado em', base);
    } else {
      console.warn('[telegram] PUBLIC_BASE_URL ausente — webhook não registrado.');
    }
  }

  const push = (chatId: string, text: string, buttons?: readonly (readonly BotButton[])[]) =>
    sendMessage(token, chatId, text, buttons);

  // Lembretes proativos (E16 Fase 3). Sobe DESLIGADO: só liga com
  // TELEGRAM_REMINDERS=on em produção e modo webhook (ver reminder-scheduler).
  startReminderScheduler({ deps, push, mode });

  return {
    secretToken,
    telemetry,
    process: (update: unknown) => processUpdate(token, deps, telemetry, update),
    push,
  };
}

export function getTelegramRuntime(): Promise<TelegramRuntime | null> {
  if (!globalForTg.__nutrimedTelegram) {
    globalForTg.__nutrimedTelegram = init();
  }
  return globalForTg.__nutrimedTelegram;
}
