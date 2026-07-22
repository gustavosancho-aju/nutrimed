'use server';

import { revalidatePath } from 'next/cache';
import { generateNoteDraft, saveNote } from '@nutrimed/clinical-notes';
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
 * Server actions da nota clínica (E9 — FR17). Toda escrita é cifrada (NFR9)
 * e auditada (NFR10) pelo Documentation Service.
 */

function buildNoteLlm(): ILlmProvider {
  // Kimi K3 assume os DOCUMENTOS LONGOS (decisão 2026-07-21): contexto de 1M
  // tokens e provedor independente da Anthropic (resiliência ao apagão de
  // créditos). Board ao vivo e visão seguem no Claude.
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
  // dev sem key: rascunho fake determinístico via completeText (mesmo padrão
  // do relatório nutricional — FakeLlmProvider não implementa completeText)
  const fake = new FakeLlmProvider('aurelio', 'sintese');
  const texts = new FakeTextCompleter([
    '## Resumo da consulta\nRascunho fake determinístico (dev sem ANTHROPIC_API_KEY).\n\n' +
      '## Pontos relatados\n- (fake)\n\n## Pontos levantados pelo board\n- (fake)\n\n' +
      '## Plano discutido\n- (fake)\n\n' +
      '_Rascunho gerado por IA — revisado e validado pelo médico responsável._',
  ]);
  return {
    complete: (req) => fake.complete(req),
    completeText: (req) => texts.completeText(req),
  };
}

async function requireConsultation(formData: FormData): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  await assertConsultationOwner(await getDb(), consultationId, user.id);
  return consultationId;
}

/**
 * Gera o rascunho da nota a partir da consulta encerrada/ativa (AC1).
 * Assinatura compatível com useActionState — retorna ActionResult (nunca lança)
 * para a mensagem de erro chegar legível ao médico em produção.
 */
export async function generateNoteAction(
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
    const llm = buildNoteLlm();
    const draft = await generateNoteDraft(llm, inputs.finals, inputs.contributions);
    const db = await getDb();
    await saveNote(db, consultationId, draft.text, getEncryptionKey(), {
      action: 'generate',
      modelVersion: draft.modelVersion ?? 'unknown',
    });
    revalidatePath(`/consultations/${consultationId}`);
    return { ok: true };
  } catch (err) {
    console.error('[nota] generateNoteAction falhou:', err);
    return toActionResult(err);
  }
}

/** Salva a edição do médico (AC2) — auditada como human-edit. */
export async function saveNoteAction(formData: FormData): Promise<void> {
  const consultationId = await requireConsultation(formData);
  const content = String(formData.get('content') ?? '').trim();
  if (!content) throw new Error('Nota vazia.');
  const db = await getDb();
  await saveNote(db, consultationId, content, getEncryptionKey(), { action: 'edit' });
  revalidatePath(`/consultations/${consultationId}`);
}
