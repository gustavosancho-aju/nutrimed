/**
 * Alerta de erro em produção (detecção/resposta). Envia um resumo do erro do
 * servidor para um chat de Telegram do responsável, reusando o mesmo transporte
 * `fetch` do bot (Bot API sendMessage) — sem SDK, sem serviço externo novo.
 *
 * Princípios:
 *  - NUNCA lança (é chamado dentro de tratamento de erro — falha em silêncio).
 *  - SEM PII/conteúdo clínico: só tipo/mensagem do erro, digest, rota e hora.
 *  - Throttle: deduplica erros iguais (janela) e tem teto global (anti-storm),
 *    para um pico de erros não virar centenas de mensagens.
 *  - Ignora o "erro" de controle de fluxo do Next (redirect/notFound) — senão
 *    todo request não-autenticado (redirect p/ /login) viraria alerta.
 *  - Desligado (no-op) sem TELEGRAM_BOT_TOKEN + ALERT_CHAT_ID.
 */

export interface ErrorInfo {
  readonly message: string;
  readonly name?: string;
  readonly digest?: string;
  readonly path?: string;
  readonly method?: string;
}

export type SendFn = (text: string) => Promise<void> | void;
export type ReportStatus = 'sent' | 'throttled' | 'skipped' | 'error';

export interface ErrorReporter {
  report(info: ErrorInfo, now: number): Promise<ReportStatus>;
}

export interface ReporterOptions {
  /** Janela de deduplicação por assinatura (mesma rota+erro). Default 5 min. */
  readonly dedupeMs?: number;
  /** Teto de mensagens na janela global (anti-storm). Default 12. */
  readonly globalMax?: number;
  /** Janela do teto global. Default 10 min. */
  readonly globalWindowMs?: number;
}

/** redirect()/notFound() do Next são fluxo de controle, não erro real. */
function isControlFlow(info: ErrorInfo): boolean {
  const d = info.digest ?? '';
  const m = info.message ?? '';
  return (
    d.startsWith('NEXT_REDIRECT') ||
    d.startsWith('NEXT_NOT_FOUND') ||
    d.startsWith('NEXT_HTTP_ERROR_FALLBACK') ||
    m === 'NEXT_REDIRECT' ||
    m.startsWith('NEXT_NOT_FOUND')
  );
}

const firstLine = (s: string) => (s.split('\n')[0] ?? '').slice(0, 120);

function buildMessage(info: ErrorInfo, now: number): string {
  const when = new Date(now).toISOString();
  const where = [info.method, info.path].filter(Boolean).join(' ') || '(rota desconhecida)';
  const head = `${info.name ?? 'Error'}: ${info.message}`.slice(0, 400);
  const digest = info.digest ? `\ndigest: ${info.digest}` : '';
  return `🚨 NutriMed — erro no servidor\n${where}\n${head}${digest}\n${when}`;
}

/** Cria um reporter com `send` injetável (testável; injete `now` em report). */
export function createErrorReporter(send: SendFn, opts: ReporterOptions = {}): ErrorReporter {
  const dedupeMs = opts.dedupeMs ?? 5 * 60_000;
  const globalMax = opts.globalMax ?? 12;
  const globalWindowMs = opts.globalWindowMs ?? 10 * 60_000;
  const seen = new Map<string, number>();
  let recent: number[] = [];

  return {
    async report(info, now) {
      if (isControlFlow(info)) return 'skipped';

      const sig = `${info.path ?? ''}|${info.name ?? ''}|${firstLine(info.message)}`;
      const last = seen.get(sig);
      if (last !== undefined && now - last < dedupeMs) return 'throttled';

      // poda entradas antigas (limita memória)
      for (const [k, t] of seen) if (now - t >= dedupeMs) seen.delete(k);
      recent = recent.filter((t) => now - t < globalWindowMs);
      if (recent.length >= globalMax) return 'throttled';

      seen.set(sig, now);
      recent.push(now);
      try {
        await send(buildMessage(info, now));
        return 'sent';
      } catch (err) {
        console.error('[alert] envio falhou:', err instanceof Error ? err.message : err);
        return 'error';
      }
    },
  };
}

/** Envio real via Bot API (no-op se o canal de alerta não estiver configurado). */
function telegramSend(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALERT_CHAT_ID;
  if (!token || !chatId) return Promise.resolve(); // canal de alerta desligado
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  }).then(() => undefined);
}

const globalForAlert = globalThis as unknown as { __nutrimedErrorReporter?: ErrorReporter };
const reporter = (globalForAlert.__nutrimedErrorReporter ??= createErrorReporter(telegramSend));

/** Reporta um erro de servidor (nunca lança). Chamado pelo onRequestError. */
export async function reportServerError(
  err: unknown,
  ctx?: { path?: string; method?: string },
): Promise<void> {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    await reporter.report(
      {
        message: e.message,
        name: e.name,
        digest: (e as { digest?: string }).digest,
        path: ctx?.path,
        method: ctx?.method,
      },
      Date.now(),
    );
  } catch {
    /* alerta nunca derruba o fluxo de erro */
  }
}
