import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getConsentStatus } from '@nutrimed/consent';
import { getCurrentUser, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grantConsentAction, revokeConsentAction } from '@/lib/consent-actions';
import { startDemoBoardAction, requestSynthesisAction } from '@/lib/board-actions';
import { generateNoteAction, saveNoteAction } from '@/lib/note-actions';
import { getBoardRuntime, getTelemetryReport, BOARD_WS_PORT } from '@/lib/board-runtime';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadNote, listSyntheses } from '@nutrimed/clinical-notes';
import { ConsultationRoom } from '@/components/consultation-room';
import { TelemetryReport } from '@/components/telemetry-report';

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
  const note = authorized ? await loadNote(db, id, getEncryptionKey()) : null;
  const syntheses = authorized ? await listSyntheses(db, id, getEncryptionKey()) : [];
  const telemetry = authorized ? await getTelemetryReport(id) : null;

  return (
    <main className="min-h-screen">
      <header className="surface-deep-gradient sticky top-0 z-10 border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              NutriMed
              <span className="ml-2 text-sm font-normal text-white/50">· Consulta</span>
            </h1>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide ${
                authorized
                  ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                  : 'border-white/20 bg-white/5 text-white/60'
              }`}
            >
              {authorized ? '🟢 gravação autorizada' : '🔒 gravação bloqueada'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {authorized ? (
              <form action={revokeConsentAction}>
                <input type="hidden" name="consultationId" value={id} />
                <button type="submit" className="text-xs text-red-300/90 hover:text-red-200 hover:underline">
                  Revogar consentimento
                </button>
              </form>
            ) : null}
            <Link href="/" className="text-sm text-white/60 transition-colors hover:text-white">
              ← Painel
            </Link>
          </div>
        </div>
        <div className="gold-hairline absolute inset-x-0 bottom-0" />
      </header>

      <div className="mx-auto max-w-7xl p-6">

      {!authorized ? (
        <section className="card-premium gold-hairline mx-auto mt-14 max-w-md p-7">
          <h2 className="font-display text-lg font-semibold text-ink">
            🔒 Consentimento de gravação
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Sem consentimento, nenhum áudio é capturado, transmitido ou persistido (FR20/LGPD). O
            servidor é a fonte de verdade da autorização.
          </p>
          <form action={grantConsentAction} className="mt-4">
            <input type="hidden" name="consultationId" value={id} />
            <button
              type="submit"
              className="w-full rounded-[10px] bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
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
                  className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold text-surface-deep shadow-sm transition-colors hover:bg-white/90"
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
                  className="rounded-[10px] border border-white/25 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                >
                  📋 Síntese
                </button>
              </form>
            }
          />

          {/* E9 — Nota clínica (FR17/A1): rascunho gerado por IA, editável pelo médico */}
          <section
            aria-label="Nota clínica"
            className="card-premium mt-6 p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  Nota clínica
                </h2>
                <p className="text-xs text-ink-muted">
                  Rascunho gerado da transcrição + board — revise, edite e salve. Cifrada em
                  repouso e auditada.
                </p>
              </div>
              <form action={generateNoteAction}>
                <input type="hidden" name="consultationId" value={id} />
                <button
                  type="submit"
                  className="rounded-[10px] border border-ink/15 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted"
                >
                  ✨ {note ? 'Regenerar rascunho' : 'Gerar nota da consulta'}
                </button>
              </form>
            </div>

            {note ? (
              <form action={saveNoteAction} className="mt-4 space-y-3">
                <input type="hidden" name="consultationId" value={id} />
                <textarea
                  key={note.updatedAt.getTime()} // remonta quando a nota muda (regenerar)
                  name="content"
                  defaultValue={note.content}
                  rows={14}
                  aria-label="Conteúdo da nota clínica"
                  className="font-mono-data w-full rounded-[10px] border border-ink/15 bg-white p-4 text-sm leading-relaxed text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink-muted">
                    Última atualização: {note.updatedAt.toLocaleString('pt-BR')}
                  </p>
                  <button
                    type="submit"
                    className="rounded-[10px] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    💾 Salvar nota
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-4 rounded-[10px] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
                Nenhuma nota ainda — rode a consulta e clique em “Gerar nota da consulta”.
              </p>
            )}
          </section>

          {/* Histórico de sínteses do board — persistidas (cifradas+auditadas) */}
          {syntheses.length > 0 && (
            <section aria-label="Sínteses do board" className="card-premium mt-6 p-6">
              <h2 className="font-display text-base font-semibold text-ink">
                Sínteses do board <span className="text-sm font-normal text-ink-muted">· histórico salvo</span>
              </h2>
              <ul className="mt-4 space-y-3">
                {[...syntheses].reverse().map((s) => (
                  <li key={s.id} className="rounded-[10px] border border-ink/10 bg-surface p-4">
                    <p className="text-sm leading-relaxed text-ink">{s.content}</p>
                    <p className="mt-2 text-[11px] text-ink-muted">
                      {s.createdAt.toLocaleString('pt-BR')}
                      {s.modelVersion ? ` · ${s.modelVersion}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {telemetry ? (
            <TelemetryReport report={telemetry.report} summary={telemetry.summary} />
          ) : null}
        </div>
      )}
      </div>
    </main>
  );
}
