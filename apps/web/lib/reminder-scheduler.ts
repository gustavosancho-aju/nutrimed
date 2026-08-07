import 'server-only';
import { runReminderTick, type PushFn, type ReminderDeps } from '@nutrimed/telegram-bot';
import { setRemindersEnabled } from '@nutrimed/telegram-link';
import { shouldRunReminders } from './reminder-guard';

/**
 * Agendador dos lembretes proativos (E16 Fase 3).
 *
 * Vive no processo do Next porque o app é um processo Node PERSISTENTE no Fly
 * (`server.mjs`), não serverless — o mesmo fato que já viabilizou a geração
 * assíncrona da projeção corporal. Não há cron externo, fila nem peça nova
 * (ADR-010).
 *
 * ┌─ POR QUE UM setInterval DE 5 MINUTOS E NÃO "às 16h em ponto" ────────────┐
 * │ Porque o processo reinicia. Deploy é rolling com drain de 5 min; se o    │
 * │ instante exato caísse no meio, o lembrete daquele dia simplesmente não   │
 * │ sairia. Com JANELA (16:00–16:59 e 21:45–22:30 locais), o próximo tick    │
 * │ ainda entrega. Passada a janela, NÃO entrega mais — lembrete das 16h     │
 * │ chegando às 19h é pior que não chegar.                                   │
 * │                                                                          │
 * │ E é barato: fora das janelas o tick compara a hora local e sai sem fazer │
 * │ consulta nenhuma.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * TRÊS GUARDAS para ligar, e todas precisam ser verdadeiras:
 *  1. `TELEGRAM_REMINDERS=on` — interruptor do operador, alcançável por
 *     `fly secrets set` SEM deploy. A lição do vazamento de custo de
 *     2026-07-24 é que todo caminho automático precisa de um freio assim.
 *  2. `NODE_ENV=production` — em dev NUNCA, mesmo com o token certo.
 *  3. modo webhook — `polling` é o sinal de "estou num ambiente de dev".
 *
 * O cenário que essas guardas de fato protegem não é escalar o Fly: é alguém
 * rodar `npm run dev` apontando para o banco e o token de produção, que é um
 * incidente que este projeto já viveu (2026-07-02).
 */

const TICK_MS = 5 * 60 * 1000;

const globalForScheduler = globalThis as unknown as {
  __nutrimedReminderTimer?: NodeJS.Timeout;
};

export interface SchedulerOptions {
  readonly deps: ReminderDeps;
  readonly push: PushFn;
  readonly mode: string;
}

/**
 * Liga o agendador se — e só se — as três guardas passarem. Idempotente: um
 * segundo start não cria um segundo timer (o singleton em globalThis é o mesmo
 * padrão do runtime do board, resistente ao HMR do Next).
 */
export function startReminderScheduler({ deps, push, mode }: SchedulerOptions): boolean {
  if (!shouldRunReminders(process.env, mode)) {
    console.log('[lembretes] agendador DESLIGADO (requer TELEGRAM_REMINDERS=on + produção + webhook).');
    return false;
  }
  if (globalForScheduler.__nutrimedReminderTimer) return true;

  const onBlocked = async (patientId: string): Promise<void> => {
    // Bloquear o bot é revogação de fato. Continuar tentando é o tipo de coisa
    // que a ANPD lê como desrespeito à oposição do titular.
    try {
      await setRemindersEnabled(deps.db, patientId, false, 'telegram-reminders-bloqueado');
      console.warn('[lembretes] envio recusado pelo Telegram — lembretes desligados para o paciente.');
    } catch (error) {
      console.error('[lembretes] falha ao desligar após recusa:', error);
    }
  };

  const tick = async (): Promise<void> => {
    try {
      const enviados = await runReminderTick(deps, push, new Date(), onBlocked);
      if (enviados.length > 0) console.log(`[lembretes] ${enviados.length} enviado(s).`);
    } catch (error) {
      // O tick NUNCA derruba o processo: um lembrete perdido é aceitável, o app
      // fora do ar não é.
      console.error('[lembretes] tick falhou:', error);
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  // `unref` para o timer não segurar o processo no shutdown.
  timer.unref?.();
  globalForScheduler.__nutrimedReminderTimer = timer;

  // O fly.toml usa rolling com drain de 5 min: sem isto, a máquina drenando
  // poderia disparar um lembrete enquanto morre.
  process.once('SIGTERM', () => {
    clearInterval(timer);
    globalForScheduler.__nutrimedReminderTimer = undefined;
  });

  console.log('[lembretes] agendador ligado (tick de 5 min, janelas 16h e 22h locais).');
  return true;
}

/** Só para teste: derruba o timer e limpa o singleton. */
export function stopReminderScheduler(): void {
  if (globalForScheduler.__nutrimedReminderTimer) {
    clearInterval(globalForScheduler.__nutrimedReminderTimer);
    globalForScheduler.__nutrimedReminderTimer = undefined;
  }
}
