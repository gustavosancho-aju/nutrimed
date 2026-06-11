'use server';

import { getCurrentUser } from './auth';
import { startDemoBoard } from './board-runtime';

/** Server action: inicia a demo do board (auth + gate de consentimento no caminho). */
export async function startDemoBoardAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  await startDemoBoard(consultationId);
}
