import { getTelegramRuntime } from '@/lib/telegram-runtime';

/**
 * Webhook do Telegram (E12 — 12.7). Recebe updates da Bot API por POST (produção).
 * Valida o secret token (X-Telegram-Bot-Api-Secret-Token) e delega ao runtime.
 * Runtime Node.js: o runtime é server-only e toca DB/cripto (nunca edge).
 * Nenhuma porta nova — entra na 3000 já exposta (ADR-010).
 */
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const rt = await getTelegramRuntime();
  if (!rt) return new Response('telegram desativado', { status: 503 });

  // Gate do canal: só o Telegram conhece o secret configurado no setWebhook.
  if (rt.secretToken) {
    const got = request.headers.get('x-telegram-bot-api-secret-token');
    if (got !== rt.secretToken) return new Response('forbidden', { status: 401 });
  }

  const update = await request.json().catch(() => null);
  if (!update) return new Response('bad request', { status: 400 });

  await rt.process(update); // processUpdate nunca relança (responde 200 sempre)
  return new Response('ok');
}
