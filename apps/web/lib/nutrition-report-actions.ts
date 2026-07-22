'use server';

import { revalidatePath } from 'next/cache';
import {
  computeNutrition,
  extractDietRecall,
  mapRecallToTaco,
  saveNutritionReport,
  writeReportDraft,
  type ReportPatientContext,
} from '@nutrimed/nutrition-report';
import { listBodyComposition, loadCurrentNutritionGoal } from '@nutrimed/patients';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import { KimiLlmProvider } from '@nutrimed/llm-kimi';
import { FakeLlmProvider, FakeTextCompleter, type ILlmProvider } from '@nutrimed/providers';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getNoteInputs } from './board-runtime';
import { assertConsultationOwner, consultationBelongsTo } from './consultation-owner';
import { toActionResult, type ActionResult } from './action-result';

/**
 * Server actions do RELATÓRIO NUTRICIONAL (E13): recordatório extraído da
 * transcrição, quantificado DETERMINISTICAMENTE pela tabela TACO — a IA nunca
 * inventa números. Escrita cifrada (NFR9) + auditada com fontes TACO (NFR10).
 */

function buildLlm(): ILlmProvider {
  // Kimi K3 assume os DOCUMENTOS LONGOS (decisão 2026-07-21) — ver note-actions.
  if (process.env.KIMI_API_KEY) {
    return new KimiLlmProvider({
      apiKey: process.env.KIMI_API_KEY,
      personaId: 'aurelio',
      longForm: true,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      personaId: 'aurelio',
    });
  }
  // dev sem key: extração roteirizada + redação fake determinística — o roteiro
  // segue a ordem das chamadas de completeText (1ª extração, 2ª redação)
  const fake = new FakeLlmProvider('aurelio', 'sintese');
  const texts = new FakeTextCompleter([
    '[{"food":"arroz branco cozido","quantity":4,"unit":"colher de sopa","meal":"almoco"},{"food":"feijão carioca cozido","meal":"almoco"}]',
    '## Recordatório alimentar\n(rascunho fake determinístico — dev sem ANTHROPIC_API_KEY)\n\n' +
      '_Rascunho gerado por IA com base na tabela TACO — revisado e validado pelo médico responsável._',
  ]);
  return {
    complete: (req) => fake.complete(req),
    completeText: (req) => texts.completeText(req),
  };
}

/** Gera o rascunho do relatório — compatível com useActionState, nunca lança. */
export async function generateNutritionReportAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, code: 'unauthenticated' };
    const consultationId = String(formData.get('consultationId') ?? '');
    if (!consultationId) return { ok: false, code: 'invalid-input' };
    if (!(await consultationBelongsTo(await getDb(), consultationId, user.id))) {
      return { ok: false, code: 'not-found' };
    }

    const inputs = await getNoteInputs(consultationId);
    if (!inputs || inputs.finals.length === 0) {
      return { ok: false, code: 'no-transcript' };
    }

    const llm = buildLlm();
    const recall = await extractDietRecall(llm, inputs.finals);
    if (recall.length === 0) return { ok: false, code: 'no-recall' };

    const db = await getDb();
    const key = getEncryptionKey();

    // Cruzamento com o paciente vinculado (E11) — ausência NÃO é erro (degrada).
    let patientContext: ReportPatientContext | undefined;
    let goal;
    const linked = await db.query<{ patient_id: string | null }>(
      'SELECT patient_id FROM consultation WHERE id = $1',
      [consultationId],
    );
    const patientId = linked.rows[0]?.patient_id ?? null;
    if (patientId) {
      const currentGoal = await loadCurrentNutritionGoal(db, patientId, key);
      goal = currentGoal?.values;
      const bodyMeasurements = await listBodyComposition(db, patientId, key);
      const latestBody = bodyMeasurements.at(-1);
      patientContext = {
        ...(currentGoal ? { goalLabel: `vigente desde ${currentGoal.effectiveFrom}` } : {}),
        ...(latestBody ? { bodyComposition: latestBody.values } : {}),
      };
    }

    const computation = computeNutrition(mapRecallToTaco(recall), goal);
    const draft = await writeReportDraft(llm, computation, patientContext);
    await saveNutritionReport(db, consultationId, draft.text, key, {
      action: 'generate',
      modelVersion: draft.modelVersion ?? 'unknown',
      data: computation,
    });
    revalidatePath(`/consultations/${consultationId}`);
    return { ok: true };
  } catch (err) {
    console.error('[relatório nutricional] generateNutritionReportAction falhou:', err);
    return toActionResult(err);
  }
}

/** Salva a edição do médico — auditada como human-edit; preserva o cálculo. */
export async function saveNutritionReportAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  const content = String(formData.get('content') ?? '').trim();
  if (!content) throw new Error('Relatório vazio.');
  const db = await getDb();
  await assertConsultationOwner(db, consultationId, user.id);
  await saveNutritionReport(db, consultationId, content, getEncryptionKey(), { action: 'edit' });
  revalidatePath(`/consultations/${consultationId}`);
}
