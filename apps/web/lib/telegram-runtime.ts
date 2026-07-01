import 'server-only';
import { loadEncryptionKey } from '@nutrimed/crypto';
import { createFoodEstimator, type FoodImageInput } from '@nutrimed/food-vision';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import type { ILlmProvider } from '@nutrimed/providers';
import { handleUpdate, handlePhoto, type BotDeps } from '@nutrimed/telegram-bot';
import { TelegramTelemetry } from '@nutrimed/telemetry';
import { getDb } from './db';

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
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
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

async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  await tgCall(token, 'sendMessage', { chat_id: chatId, text });
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
  const msg = update.message ?? update.edited_message;
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  try {
    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1]!;
      const image = await downloadPhoto(token, largest.file_id);
      const reply = await handlePhoto(deps, chatId, image, largest.file_id, msg.caption);
      telemetry.photoLogged(chatId, localDay());
      console.log(
        `[telegram] foto processada — pacientes ativos: ${telemetry.report().activePatients}, ` +
          `custo de visão acumulado ~US$${telemetry.visionUsd().toFixed(4)}`,
      );
      await sendMessage(token, chatId, reply.text);
      return;
    }
    if (typeof msg.text === 'string') {
      const reply = await handleUpdate(deps, { chatId, text: msg.text });
      if (reply) await sendMessage(token, chatId, reply.text);
    }
  } catch (error) {
    console.error('[telegram] falha ao processar update:', error);
    // Não relança: o webhook responde 200 e o polling segue (sem retry-storm).
  }
}

/** Loop de long-polling (dev). Não-bloqueante: chamado com `void`. */
async function pollLoop(token: string, deps: BotDeps, telemetry: TelegramTelemetry): Promise<void> {
  await tgCall(token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => undefined);
  let offset = 0;
  for (;;) {
    try {
      const res = await tgCall<TgUpdate[]>(token, 'getUpdates', { offset, timeout: 30 });
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
    void pollLoop(token, deps, telemetry);
    console.log('[telegram] long-polling iniciado (dev).');
  } else {
    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (base) {
      await tgCall(token, 'setWebhook', {
        url: `${base}/api/telegram/webhook`,
        ...(secretToken ? { secret_token: secretToken } : {}),
      });
      console.log('[telegram] webhook registrado em', base);
    } else {
      console.warn('[telegram] PUBLIC_BASE_URL ausente — webhook não registrado.');
    }
  }

  return {
    secretToken,
    telemetry,
    process: (update: unknown) => processUpdate(token, deps, telemetry, update),
  };
}

export function getTelegramRuntime(): Promise<TelegramRuntime | null> {
  if (!globalForTg.__nutrimedTelegram) {
    globalForTg.__nutrimedTelegram = init();
  }
  return globalForTg.__nutrimedTelegram;
}
