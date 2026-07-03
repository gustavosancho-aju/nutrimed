'use client';

import { useState, useTransition } from 'react';
import { generatePairingCodeAction, revokeChannelAction } from '@/lib/telegram-actions';

/**
 * Painel do canal Telegram na ficha (E12/12.4). Gera o código de pareamento
 * (exibido UMA vez), mostra o status e permite revogar. O código em si é o
 * consentimento do paciente (ADR-013/014) — some da tela ao recarregar.
 */
export function TelegramLinkPanel({ patientId, active }: { patientId: string; active: boolean }) {
  const [code, setCode] = useState<string | null>(null);
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

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-ink">
          Status:{' '}
          {active ? (
            <span className="font-medium text-brand">Canal ativo ✅</span>
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
            className="rounded-[10px] bg-brand px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Gerando…' : 'Gerar código de vínculo'}
          </button>
        )}
      </div>

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
