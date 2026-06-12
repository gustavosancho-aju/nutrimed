'use server';

import { getCurrentUser } from './auth';
import { startDemoBoard, requestSynthesis, startLiveBoard, stopLiveBoard } from './board-runtime';

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

/** Server action: inicia a consulta AO VIVO (mic real → Deepgram → board). */
export async function startLiveBoardAction(consultationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  await startLiveBoard(consultationId);
}

/** Server action: encerra a consulta ao vivo. */
export async function stopLiveBoardAction(consultationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  await stopLiveBoard(consultationId);
}
