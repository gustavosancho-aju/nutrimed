import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getConsentStatus } from '@nutrimed/consent';
import { getCurrentUser, SESSION_COOKIE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grantConsentAction, revokeConsentAction } from '@/lib/consent-actions';
import { startDemoBoardAction, requestSynthesisAction } from '@/lib/board-actions';
import { saveNoteAction } from '@/lib/note-actions';
import { saveNutritionReportAction } from '@/lib/nutrition-report-actions';
import { NoteGeneratorForm } from '@/components/note-generator-form';
import { NutritionReportForm } from '@/components/nutrition-report-form';
import { loadNutritionReport } from '@nutrimed/nutrition-report';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { getBoardRuntime, getTelemetryReport, BOARD_WS_PORT } from '@/lib/board-runtime';
import { getEncryptionKey } from '@/lib/crypto-key';
import { loadNote, listSyntheses, listTranscriptFinals, loadTranscriptReview } from '@nutrimed/clinical-notes';
import { saveTranscriptReviewAction } from '@/lib/transcript-actions';
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
  // A6: em modo attached o WS vai pela MESMA origem/porta da página ('' ⇒
  // o cliente deriva wss://host). Fora dele, env explícita ou dev local (3001).
  const wsBaseUrl =
    process.env.BOARD_WS_MODE === 'attached'
      ? (process.env.NEXT_PUBLIC_BOARD_WS_URL ?? '')
      : (process.env.NEXT_PUBLIC_BOARD_WS_URL ?? `ws://localhost:${BOARD_WS_PORT}`);
  const note = authorized ? await loadNote(db, id, getEncryptionKey()) : null;
  const nutritionReport = authorized ? await loadNutritionReport(db, id, getEncryptionKey()) : null;
  // Leitura durável NUNCA derruba a página: chave rotacionada / linha corrompida
  // degrada para "sem transcrição" (mesma postura de getNoteInputs), em vez de
  // estourar toda a consulta.
  let transcriptFinals: string[] = [];
  let transcriptReview: Awaited<ReturnType<typeof loadTranscriptReview>> = null;
  if (authorized) {
    try {
      transcriptReview = await loadTranscriptReview(db, id, getEncryptionKey());
      transcriptFinals = await listTranscriptFinals(db, id, getEncryptionKey());
    } catch (error) {
      console.error('[consulta] falha ao ler transcrição — seção oculta:', error);
    }
  }
  const transcriptText = transcriptReview?.content ?? transcriptFinals.join('\n');
  const hasTranscript = transcriptText.trim().length > 0;
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

          {/* Transcrição Confiável: o médico corrige o que o STT ouviu ANTES de gerar
              os documentos — a versão revisada vira a fonte da nota e do relatório.
              Só aparece quando há transcrição persistida (consulta ao vivo). */}
          {hasTranscript && (
            <section aria-label="Transcrição da consulta" className="card-premium mt-6 p-6">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  📝 Transcrição da consulta
                </h2>
                <p className="text-xs text-ink-muted">
                  Revise e corrija o que a transcrição automática captou. A nota clínica e o
                  relatório nutricional são gerados a partir desta versão — o médico decide o que
                  vira registro. Cifrada em repouso e auditada.
                </p>
              </div>
              <form action={saveTranscriptReviewAction} className="mt-4 space-y-3">
                <input type="hidden" name="consultationId" value={id} />
                <textarea
                  key={transcriptReview?.updatedAt.getTime() ?? 'raw'}
                  name="content"
                  defaultValue={transcriptText}
                  rows={12}
                  aria-label="Transcrição da consulta"
                  className="w-full rounded-[10px] border border-ink/15 bg-white p-4 text-sm leading-relaxed text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-ink-muted">
                    {transcriptReview
                      ? `Revisada em ${transcriptReview.updatedAt.toLocaleString('pt-BR')} — regenere a nota e o relatório para refletir as correções.`
                      : 'Ainda mostra a transcrição automática. Corrija termos clínicos e alimentos antes de gerar os documentos.'}
                  </p>
                  <button
                    type="submit"
                    className="shrink-0 rounded-[10px] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  >
                    💾 Salvar transcrição corrigida
                  </button>
                </div>
              </form>
            </section>
          )}

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
              <NoteGeneratorForm consultationId={id} hasNote={Boolean(note)} />
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

          {/* E13 — Relatório nutricional (TACO): recordatório da transcrição,
              quantificado deterministicamente; IA redige, médico decide */}
          <section aria-label="Relatório nutricional" className="card-premium mt-6 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  🥗 Relatório nutricional
                </h2>
                <p className="text-xs text-ink-muted">
                  Recordatório extraído da transcrição e quantificado pela tabela TACO
                  {nutritionReport?.tacoVersion ? ` (${nutritionReport.tacoVersion})` : ''} — revise,
                  edite e salve. Cifrado em repouso e auditado.
                </p>
              </div>
              <NutritionReportForm consultationId={id} hasReport={Boolean(nutritionReport)} />
            </div>

            {nutritionReport ? (
              <>
                {nutritionReport.data ? (
                  <div className="mt-4 overflow-x-auto rounded-[10px] border border-ink/10">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface text-ink-muted">
                        <tr>
                          <th className="px-3 py-2 font-medium">Item relatado</th>
                          <th className="px-3 py-2 font-medium">Porção</th>
                          <th className="px-3 py-2 font-medium">kcal</th>
                          <th className="px-3 py-2 font-medium">Prot. (g)</th>
                          <th className="px-3 py-2 font-medium">Carb. (g)</th>
                          <th className="px-3 py-2 font-medium">Gord. (g)</th>
                          <th className="px-3 py-2 font-medium">Fonte TACO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nutritionReport.data.items.map((entry, idx) =>
                          entry.taco && entry.nutrients ? (
                            <tr key={idx} className="border-t border-ink/10 text-ink">
                              <td className="px-3 py-2">
                                {entry.item.food}
                                {entry.status === 'uncertain' ? (
                                  <span className="ml-1 text-amber-600" title="Correspondência incerta na TACO">
                                    ⚠
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                {entry.grams} g
                                {entry.gramsEstimated ? (
                                  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">
                                    ~estimada{entry.portionLabel ? `: ${entry.portionLabel}` : ''}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">{entry.nutrients.kcal ?? '—'}</td>
                              <td className="px-3 py-2">{entry.nutrients.protein ?? '—'}</td>
                              <td className="px-3 py-2">{entry.nutrients.carbs ?? '—'}</td>
                              <td className="px-3 py-2">{entry.nutrients.fat ?? '—'}</td>
                              <td className="px-3 py-2 text-ink-muted">
                                {entry.taco.description}{' '}
                                <span className="text-[10px]">#{entry.taco.id}</span>
                              </td>
                            </tr>
                          ) : null,
                        )}
                        <tr className="border-t border-ink/15 bg-surface font-semibold text-ink">
                          <td className="px-3 py-2">Totais</td>
                          <td className="px-3 py-2 text-[10px] font-normal text-ink-muted">
                            {nutritionReport.data.estimatedCount > 0
                              ? `${nutritionReport.data.estimatedCount} porção(ões) estimada(s)`
                              : 'todas as porções relatadas'}
                          </td>
                          <td className="px-3 py-2">{nutritionReport.data.totals.kcal ?? 0}</td>
                          <td className="px-3 py-2">{nutritionReport.data.totals.protein ?? 0}</td>
                          <td className="px-3 py-2">{nutritionReport.data.totals.carbs ?? 0}</td>
                          <td className="px-3 py-2">{nutritionReport.data.totals.fat ?? 0}</td>
                          <td className="px-3 py-2" />
                        </tr>
                        {nutritionReport.data.goal && nutritionReport.data.goalDelta ? (
                          <tr className="border-t border-ink/10 text-ink-muted">
                            <td className="px-3 py-2">Δ vs meta vigente</td>
                            <td className="px-3 py-2 text-[10px]">
                              meta: {nutritionReport.data.goal.kcal} kcal
                            </td>
                            <td className="px-3 py-2">{nutritionReport.data.goalDelta.kcal}</td>
                            <td className="px-3 py-2">{nutritionReport.data.goalDelta.protein}</td>
                            <td className="px-3 py-2">{nutritionReport.data.goalDelta.carbs}</td>
                            <td className="px-3 py-2">{nutritionReport.data.goalDelta.fat}</td>
                            <td className="px-3 py-2" />
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    {nutritionReport.data.unmatched.length > 0 ? (
                      <p className="border-t border-ink/10 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        ⚠ Sem correspondência na TACO (fora dos totais):{' '}
                        {nutritionReport.data.unmatched.map((u) => u.food).join(' · ')}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <form action={saveNutritionReportAction} className="mt-4 space-y-3">
                  <input type="hidden" name="consultationId" value={id} />
                  <textarea
                    key={nutritionReport.updatedAt.getTime()} // remonta ao regenerar
                    name="content"
                    defaultValue={nutritionReport.content}
                    rows={14}
                    aria-label="Conteúdo do relatório nutricional"
                    className="font-mono-data w-full rounded-[10px] border border-ink/15 bg-white p-4 text-sm leading-relaxed text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-ink-muted">
                      Última atualização: {nutritionReport.updatedAt.toLocaleString('pt-BR')} ·
                      rascunho gerado por IA com base na tabela TACO — IA assiste, o médico decide.
                    </p>
                    <button
                      type="submit"
                      className="rounded-[10px] bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      💾 Salvar relatório
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <p className="mt-4 rounded-[10px] border border-dashed border-ink/15 p-4 text-sm text-ink-muted">
                Nenhum relatório ainda — rode a consulta ao vivo e clique em “Gerar relatório
                nutricional”.
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

          {/* A5 — triagem do pipeline em 30s (médico/suporte) */}
          <DiagnosticsPanel consultationId={id} />
        </div>
      )}
      </div>
    </main>
  );
}
