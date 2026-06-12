import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getConsentStatus } from '@nutrimed/consent';
import { getCurrentUser, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grantConsentAction, revokeConsentAction } from '@/lib/consent-actions';
import { startDemoBoardAction, requestSynthesisAction } from '@/lib/board-actions';
import { getBoardRuntime, BOARD_WS_PORT } from '@/lib/board-runtime';
import { ConsultationRoom } from '@/components/consultation-room';

/**
 * Tela de Consulta (E7 — frontend-spec §4): header fino, gate de consentimento
 * (1.4) e o board completo (transcrição + painel lateral).
 */
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

  await getBoardRuntime();
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  const wsBaseUrl = process.env.NEXT_PUBLIC_BOARD_WS_URL ?? `ws://localhost:${BOARD_WS_PORT}`;

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6">
      <header className="flex items-center justify-between border-b border-gray-200 pb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-ink">NutriMed · Consulta</h1>
          <span className="text-xs text-ink-muted">
            {authorized ? '🟢 gravação autorizada' : '🔒 gravação bloqueada'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {authorized ? (
            <form action={revokeConsentAction}>
              <input type="hidden" name="consultationId" value={id} />
              <button type="submit" className="text-xs text-red-700 hover:underline">
                Revogar consentimento
              </button>
            </form>
          ) : null}
          <Link href="/" className="text-sm text-ink-muted hover:underline">
            ← Painel
          </Link>
        </div>
      </header>

      {!authorized ? (
        <section className="mx-auto mt-12 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-ink">🔒 Consentimento de gravação</h2>
          <p className="mt-1 text-sm text-gray-700">
            Sem consentimento, nenhum áudio é capturado, transmitido ou persistido (FR20/LGPD). O
            servidor é a fonte de verdade da autorização.
          </p>
          <form action={grantConsentAction} className="mt-4">
            <input type="hidden" name="consultationId" value={id} />
            <button
              type="submit"
              className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Registrar consentimento de gravação
            </button>
          </form>
        </section>
      ) : (
        <div className="mt-4">
          <ConsultationRoom
            consultationId={id}
            token={sessionToken}
            wsBaseUrl={wsBaseUrl}
            startForm={
              <form action={startDemoBoardAction}>
                <input type="hidden" name="consultationId" value={id} />
                <button
                  type="submit"
                  className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                >
                  ▶ Consulta simulada
                </button>
              </form>
            }
            synthesisForm={
              <form action={requestSynthesisAction}>
                <input type="hidden" name="consultationId" value={id} />
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-white"
                >
                  📋 Síntese
                </button>
              </form>
            }
          />
        </div>
      )}
    </main>
  );
}
