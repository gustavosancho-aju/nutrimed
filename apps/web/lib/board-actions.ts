'use server';

import { getCurrentUser } from './auth';
import { startDemoBoard, requestSynthesis, startLiveBoard, stopLiveBoard } from './board-runtime';
import { toActionResult, type ActionResult } from './action-result';

/** Server action: inicia a demo do board (auth + gate de consentimento no caminho). */
export async function startDemoBoardAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  await startDemoBoard(consultationId);
}

/** Server action: síntese do Aurélio sob demanda (FR18). */
export async function requestSynthesisAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  await requestSynthesis(consultationId);
}

/**
 * Server action: inicia a consulta AO VIVO (mic real → Deepgram → board).
 * NUNCA lança — em produção o Next mascara mensagens de erro de server action;
 * o resultado tipado preserva o motivo (consentimento, STT, etc.) para o cliente.
 */
export async function startLiveBoardAction(consultationId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (!consultationId) return { ok: false, code: 'invalid-input' };
  try {
    await startLiveBoard(consultationId);
    return { ok: true };
  } catch (err) {
    console.error('[board] startLiveBoard falhou:', err);
    return toActionResult(err);
  }
}

/** Server action: encerra a consulta ao vivo (nunca lança). */
export async function stopLiveBoardAction(consultationId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  try {
    await stopLiveBoard(consultationId);
    return { ok: true };
  } catch (err) {
    console.error('[board] stopLiveBoard falhou:', err);
    return toActionResult(err);
  }
}
