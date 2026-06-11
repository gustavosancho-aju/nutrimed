'use client';

import { useActionState } from 'react';
import { loginAction } from '@/lib/auth-actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <form
        action={action}
        className="w-full max-w-sm space-y-4 rounded-xl border border-gray-200 bg-white p-8 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">NutriMed</h1>
          <p className="text-sm text-gray-500">Acesso do nutrólogo</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700">Senha</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
          />
        </label>

        {state.error ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {pending ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="rounded-md bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
          Demo: <strong>demo@nutrimed.test</strong> / <strong>nutrimed123</strong>
        </p>
      </form>
    </main>
  );
}
