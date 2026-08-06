'use client';

import { useState, useTransition } from 'react';
import { generatePairingCodeAction, revokeChannelAction, setRemindersAction } from '@/lib/telegram-actions';

/**
 * Painel do canal Telegram na ficha (E12/12.4). Gera o código de pareamento
 * (exibido UMA vez), mostra o status e permite revogar. O código em si é o
 * consentimento do paciente (ADR-013/014) — some da tela ao recarregar.
 */
export function TelegramLinkPanel({
  patientId,
  active,
  remindersEnabled = false,
}: {
  patientId: string;
  active: boolean;
  /** E16 Fase 3 — lembretes proativos. Nasce FALSE: é finalidade nova (CJ-14). */
  remindersEnabled?: boolean;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [reminders, setReminders] = useState(remindersEnabled);
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      setCode(await generatePairingCodeAction(patientId));
    });
  }

  function revoke() {
    startTransition(async () => {
      await revokeChannelAction(patientId);
      setCode(null);
    });
  }

  function toggleReminders(next: boolean) {
    setReminders(next); // otimista: o toggle responde na hora
    startTransition(async () => {
      const fd = new FormData();
      fd.set('patientId', patientId);
      if (next) fd.set('enabled', 'on');
      await setRemindersAction(fd);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-ink">
          Status:{' '}
          {active ? (
            <span className="font-medium text-brand">Canal ativo ✓</span>
          ) : (
            <span className="text-ink-muted">Não vinculado</span>
          )}
        </span>
        {active ? (
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className="rounded-[10px] border border-ink/15 px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {pending ? '…' : 'Revogar canal'}
          </button>
        ) : (
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="rounded-[10px] bg-brand px-4 py-1.5 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Gerando…' : 'Gerar código de vínculo'}
          </button>
        )}
      </div>

      {active && (
        <div className="mt-4 rounded-[10px] border border-ink/10 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={reminders}
              onChange={(e) => toggleReminders(e.target.checked)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
            />
            <span className="text-sm">
              <span className="font-medium text-ink">Enviar lembretes ao paciente</span>
              <span className="mt-1 block text-xs text-ink-muted">
                O bot passa a INICIAR contato: à tarde, se o registro do dia estiver bem abaixo da
                meta; à noite, se faltar alguma refeição. Isso é uma finalidade diferente da que o
                paciente aceitou ao parear — ative só depois de combinar com ele. O paciente pode
                desligar sozinho a qualquer momento enviando <code>/silenciar</code>.
              </span>
            </span>
          </label>
        </div>
      )}

      {code && (
        <div className="mt-4 rounded-[10px] border border-brand/20 bg-brand/5 p-4">
          <p className="text-xs uppercase tracking-wide text-brand">Código de vínculo (mostrado só uma vez)</p>
          <p className="mt-2 text-sm text-ink">
            Peça ao paciente para abrir o bot do consultório no Telegram e enviar:
          </p>
          <p className="mt-2 select-all rounded-[8px] border border-ink/10 bg-surface px-3 py-2 font-mono text-base font-semibold tracking-widest text-ink">
            /start {code}
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            Válido por 15 minutos. Ao enviar o código, o paciente consente com o uso do canal (revogável).
          </p>
        </div>
      )}
    </div>
  );
}
