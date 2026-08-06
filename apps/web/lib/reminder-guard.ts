/**
 * As três guardas que decidem se o agendador de lembretes pode ligar (E16 Fase 3).
 *
 * Vive separada do `reminder-scheduler.ts` porque aquele módulo é `server-only`
 * (toca banco e env) e isso o torna intestável. A DECISÃO de ligar é função
 * pura — e é justamente ela que precisa de teste.
 *
 * As três precisam ser verdadeiras:
 *  1. `TELEGRAM_REMINDERS=on` — interruptor do operador, alcançável por
 *     `fly secrets set` SEM deploy. Lição do vazamento de custo de 2026-07-24:
 *     todo caminho automático precisa de um freio que não exija build.
 *  2. `NODE_ENV=production` — em dev NUNCA, mesmo com o token certo.
 *  3. modo diferente de `polling` — polling é o sinal de "ambiente de dev".
 *
 * O cenário que elas de fato protegem não é escalar o Fly: é alguém rodar
 * `npm run dev` apontando para o banco e o token de produção — incidente que
 * este projeto já viveu (2026-07-02).
 */
export function shouldRunReminders(env: NodeJS.ProcessEnv, mode: string): boolean {
  return env.TELEGRAM_REMINDERS === 'on' && env.NODE_ENV === 'production' && mode !== 'polling';
}
