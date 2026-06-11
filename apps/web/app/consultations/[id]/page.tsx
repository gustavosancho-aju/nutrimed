import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getConsentStatus } from '@nutrimed/consent';
import { getCurrentUser, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grantConsentAction, revokeConsentAction } from '@/lib/consent-actions';
import { startDemoBoardAction, requestSynthesisAction } from '@/lib/board-actions';
import { getBoardRuntime, BOARD_WS_PORT } from '@/lib/board-runtime';
import { DisclaimerNote } from '@/components/disclaimer-note';
import { BoardFeed } from '@/components/board-feed';

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const db = await getDb();
  const consent = await getConsentStatus(db, id);
  if (!consent) notFound();

  const authorized = consent.granted;

  // demo do board (E3): garante o gateway WS de pé e passa o token p/ o cliente
  await getBoardRuntime();
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const wsBaseUrl = process.env.NEXT_PUBLIC_BOARD_WS_URL ?? `ws://localhost:${BOARD_WS_PORT}`;

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <header className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Consulta</h1>
          <p className="text-sm text-gray-500">Consentimento de gravação</p>
        </div>
        <Link href="/" className="text-sm text-gray-600 hover:underline">
          ← Painel
        </Link>
      </header>

      {/* Estado da captura — reflexo do veredito do SERVIDOR (AC3) */}
      <section
        className={`mt-8 rounded-lg border p-6 ${
          authorized ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'
        }`}
      >
        <h2 className="text-lg font-semibold text-gray-900">
          {authorized ? '🟢 Gravação autorizada' : '🔒 Gravação bloqueada'}
        </h2>
        <p className="mt-1 text-sm text-gray-700">
          {authorized
            ? 'Há consentimento vigente. A captura de áudio do board pode ser iniciada.'
            : 'Sem consentimento de gravação, nenhum áudio é capturado, transmitido ou persistido (FR20/LGPD).'}
        </p>

        {authorized && consent.grantedAt ? (
          <p className="mt-3 text-xs text-gray-500">
            Consentido por <strong>{user.displayName}</strong> em{' '}
            {consent.grantedAt.toLocaleString('pt-BR')}.
          </p>
        ) : null}

        <div className="mt-5">
          {authorized ? (
            <form action={revokeConsentAction}>
              <input type="hidden" name="consultationId" value={id} />
              <button
                type="submit"
                className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Revogar consentimento (interrompe a captura)
              </button>
            </form>
          ) : (
            <form action={grantConsentAction}>
              <input type="hidden" name="consultationId" value={id} />
              <button
                type="submit"
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Registrar consentimento de gravação
              </button>
            </form>
          )}
        </div>

        {/* Disclaimer no contexto do card (frontend-spec §6) — mesmo Atom do chrome (AC6) */}
        <div className="mt-4 border-t border-gray-200/70 pt-3">
          <DisclaimerNote variant="card" />
        </div>
      </section>

      <p className="mt-4 text-xs text-gray-500">
        A decisão de autorização é do servidor: a captura do board (E2) só liga após consultar o
        gate <code>/api/consultations/{id}/capture-authorization</code>.
      </p>

      {/* Walking skeleton do board (E3): consulta simulada → Dr. Paulo ao vivo */}
      {authorized ? (
        <section className="mt-8 space-y-4 rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Demo do board (E3)</h2>
              <p className="text-sm text-gray-500">
                Consulta simulada (STT roteirizado) — o restante do caminho é real: gatilho →
                Claude Haiku → auditoria → WebSocket → feed.
              </p>
            </div>
            <div className="flex gap-2">
              <form action={startDemoBoardAction}>
                <input type="hidden" name="consultationId" value={id} />
                <button
                  type="submit"
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  ▶ Iniciar consulta simulada
                </button>
              </form>
              <form action={requestSynthesisAction}>
                <input type="hidden" name="consultationId" value={id} />
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  📋 Pedir síntese
                </button>
              </form>
            </div>
          </div>
          <BoardFeed consultationId={id} token={sessionToken} wsBaseUrl={wsBaseUrl} />
        </section>
      ) : null}
    </main>
  );
}
