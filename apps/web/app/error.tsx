'use client';

/**
 * Error boundary global do app (Next App Router exige client component).
 * Substitui a tela genérica "This page couldn't load" por uma mensagem
 * amigável em pt-BR. O `digest` correlaciona com o stack real no log do
 * servidor (ex.: `flyctl logs -a nutrimed`) — essencial para diagnosticar
 * erros de produção sem expor detalhes ao usuário.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center p-8">
      <div className="card-premium gold-hairline w-full p-10 text-center">
        <p aria-hidden className="text-3xl">
          ⚠️
        </p>
        <h1 className="mt-3 font-display text-xl font-semibold text-ink">
          Não foi possível carregar esta página
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Ocorreu um erro inesperado ao montar a página. Seus dados estão seguros — tente
          novamente em instantes.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-[10px] bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="rounded-[10px] border border-ink/15 px-5 py-2.5 text-sm text-ink transition-colors hover:bg-surface-muted"
          >
            ← Voltar ao início
          </a>
        </div>
        {error.digest && (
          <p className="mt-6 text-[11px] text-ink-muted">Código do erro: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
