import Link from 'next/link';
import { redirect } from 'next/navigation';
import { decryptField } from '@nutrimed/crypto';
import { totpAuthUri } from '@nutrimed/auth';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getEncryptionKey } from '@/lib/crypto-key';
import {
  generateTotpSecretAction,
  confirmTotpAction,
  disableTotpAction,
} from '@/lib/twofa-actions';

/** Agrupa a chave base32 em blocos de 4 para leitura/digitação. */
function grouped(s: string): string {
  return s.replace(/(.{4})/g, '$1 ').trim();
}

const CODE_INPUT =
  'w-40 rounded-[10px] border border-ink/15 bg-white px-3.5 py-2.5 text-center text-lg tracking-[0.4em] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
const BTN =
  'rounded-[10px] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90';

/**
 * Segurança da conta: verificação em duas etapas (TOTP). Cadastro por chave
 * manual/otpauth (compatível com Google Authenticator, Authy, 1Password).
 * Opcional — o médico ativa quando quiser; o login só exige o código após ativar.
 */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { erro, ok } = await searchParams;

  const db = await getDb();
  const res = await db.query<{ totp_enabled: boolean; totp_secret_enc: string | null }>(
    'SELECT totp_enabled, totp_secret_enc FROM app_user WHERE id = $1',
    [user.id],
  );
  const enabled = res.rows[0]?.totp_enabled ?? false;
  const pendingSecret =
    !enabled && res.rows[0]?.totp_secret_enc
      ? decryptField(res.rows[0].totp_secret_enc, getEncryptionKey())
      : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl p-8">
      <header className="border-b border-ink/10 pb-5">
        <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
          ← Painel
        </Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Segurança</h1>
      </header>

      {ok && (
        <p
          role="status"
          className="mt-6 rounded-[10px] border border-emerald-300/60 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-700"
        >
          {ok === 'disabled'
            ? 'Verificação em duas etapas desativada.'
            : 'Verificação em duas etapas ativada. 🎉'}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mt-6 rounded-[10px] border border-red-300/60 bg-red-400/10 px-4 py-2.5 text-sm text-red-700"
        >
          {erro}
        </p>
      )}

      <section className="card-premium gold-hairline mt-8 p-7">
        <h2 className="font-display text-base font-semibold text-ink">
          Verificação em duas etapas (2FA)
        </h2>

        {enabled ? (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-emerald-700">
              ✓ Ativada — no login, além da senha, pedimos um código do seu app autenticador.
            </p>
            <form action={disableTotpAction} className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-xs text-ink-muted">
                  Para desativar, digite um código atual
                </span>
                <input name="totp" inputMode="numeric" maxLength={6} required placeholder="000000" className={CODE_INPUT} />
              </label>
              <button type="submit" className="rounded-[10px] border border-ink/15 px-4 py-2.5 text-sm text-ink transition-colors hover:bg-surface-muted">
                Desativar
              </button>
            </form>
          </div>
        ) : pendingSecret ? (
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-sm text-ink">
                <strong>1.</strong> No seu app autenticador (Google Authenticator, Authy, 1Password…),
                escolha <em>adicionar conta &rarr; inserir chave manualmente</em> e use:
              </p>
              <code className="mt-2 block select-all rounded-[10px] bg-surface-muted px-4 py-3 text-center font-mono text-base tracking-wider text-ink">
                {grouped(pendingSecret)}
              </code>
              <p className="mt-1 text-[11px] text-ink-muted">
                Conta: {user.email} · Emissor: NutriMed · 6 dígitos · 30s
              </p>
              <details className="mt-2 text-[11px] text-ink-muted">
                <summary className="cursor-pointer">Ou cole este link otpauth</summary>
                <code className="mt-1 block select-all break-all rounded-[8px] bg-surface-muted px-3 py-2 font-mono">
                  {totpAuthUri(pendingSecret, user.email, 'NutriMed')}
                </code>
              </details>
            </div>
            <form action={confirmTotpAction} className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-xs text-ink-muted">
                  <strong>2.</strong> Digite o código de 6 dígitos que o app mostrar
                </span>
                <input name="totp" inputMode="numeric" maxLength={6} autoFocus required placeholder="000000" className={CODE_INPUT} />
              </label>
              <button type="submit" className={BTN}>
                Ativar 2FA
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <p className="text-sm text-ink-muted">
              Adicione uma segunda camada ao login: além da senha, um código temporário gerado por um
              app autenticador no seu celular. Protege a conta mesmo se a senha vazar.
            </p>
            <form action={generateTotpSecretAction}>
              <button type="submit" className={BTN}>
                Ativar verificação em duas etapas
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
