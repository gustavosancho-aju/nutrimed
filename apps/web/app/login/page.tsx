'use client';

import { useActionState } from 'react';
import { loginAction } from '@/lib/auth-actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, {});

  return (
    <main className="surface-deep-gradient flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* marca acima do card — serif + eyebrow dourado + filete UNIC */}
        <div className="mb-8 text-center">
          <div className="gold-hairline mx-auto mb-5 w-24" />
          <h1 className="font-display text-5xl font-medium tracking-tight text-white">
            NutriMed
          </h1>
          <p className="brand-eyebrow mt-3 text-white/70">Board de especialistas clínicos</p>
          <div className="gold-hairline mx-auto mt-5 w-24" />
        </div>

        <form action={action} className="card-premium space-y-5 p-8">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Acesso do nutrólogo</h2>
            <p className="mt-0.5 text-xs text-ink-muted">A IA assiste, o médico decide.</p>
          </div>

          {state.needsTotp ? (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-ink">Código de verificação</span>
              <input
                name="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                required
                placeholder="000000"
                className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-center text-lg tracking-[0.4em] text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <span className="block text-xs text-ink-muted">
                Abra seu app autenticador e digite o código de 6 dígitos.
              </span>
            </label>
          ) : (
            <>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">Usuário</span>
                <input
                  name="email"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">Senha</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
            </>
          )}

          {state.error ? (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-[10px] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'Entrando…' : state.needsTotp ? 'Verificar' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
