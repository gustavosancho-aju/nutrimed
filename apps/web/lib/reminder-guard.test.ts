import { describe, it, expect } from 'vitest';
import { shouldRunReminders } from './reminder-guard';

/**
 * As três guardas do agendador (E16 Fase 3). Testadas separadas do timer porque
 * o que importa aqui é a DECISÃO de ligar, não o `setInterval`.
 *
 * O cenário que elas de fato protegem não é escalar o Fly — é alguém rodar
 * `npm run dev` apontando para o banco e o token de produção, incidente que este
 * projeto já viveu em 2026-07-02.
 */
describe('guardas do agendador de lembretes', () => {
  const prod = { NODE_ENV: 'production', TELEGRAM_REMINDERS: 'on' } as NodeJS.ProcessEnv;

  it('só liga com as TRÊS condições verdadeiras', () => {
    expect(shouldRunReminders(prod, 'webhook')).toBe(true);
  });

  it('sem TELEGRAM_REMINDERS=on não liga — é o interruptor do operador', () => {
    // Precisa ser alcançável por `fly secrets set`, SEM deploy: a lição do
    // vazamento de custo de 2026-07-24 é que todo caminho automático precisa
    // de um freio assim.
    expect(shouldRunReminders({ NODE_ENV: 'production' } as NodeJS.ProcessEnv, 'webhook')).toBe(false);
    expect(shouldRunReminders({ ...prod, TELEGRAM_REMINDERS: 'off' }, 'webhook')).toBe(false);
    expect(shouldRunReminders({ ...prod, TELEGRAM_REMINDERS: 'true' }, 'webhook')).toBe(false);
  });

  it('fora de produção NUNCA liga, mesmo com o interruptor ligado', () => {
    expect(shouldRunReminders({ ...prod, NODE_ENV: 'development' }, 'webhook')).toBe(false);
    expect(shouldRunReminders({ ...prod, NODE_ENV: 'test' }, 'webhook')).toBe(false);
  });

  it('modo polling não liga — polling é o sinal de ambiente de dev', () => {
    expect(shouldRunReminders(prod, 'polling')).toBe(false);
  });

  it('ambiente vazio não liga (o default é DESLIGADO)', () => {
    expect(shouldRunReminders({} as NodeJS.ProcessEnv, 'webhook')).toBe(false);
  });
});
