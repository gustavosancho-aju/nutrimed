import { NextResponse } from 'next/server';
import { isCaptureAuthorized } from '@nutrimed/consent';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { consultationBelongsTo } from '@/lib/consultation-owner';

/**
 * Gate de servidor da captura de áudio (AC1/AC3/AC6, FR20).
 *
 * Este é o ponto único de autorização que o pipeline de captura do E2 DEVE
 * consultar antes de ligar qualquer microfone/stream. O cliente nunca decide:
 * - 401 se não autenticado;
 * - 403 se não houver consentimento válido (ausente ou revogado) → captura proibida;
 * - 200 `{ authorized: true }` apenas com consentimento vigente.
 *
 * A captura real (streaming/STT) é do E2; aqui garantimos que ela só pode
 * ligar atrás deste veredito.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ authorized: false, reason: 'unauthenticated' }, { status: 401 });
  }

  const { id: consultationId } = await params;
  const db = await getDb();

  // Posse antes do gate de consentimento: não vaza o estado de consulta alheia.
  if (!(await consultationBelongsTo(db, consultationId, user.id))) {
    return NextResponse.json({ authorized: false, reason: 'not_found' }, { status: 404 });
  }

  const authorized = await isCaptureAuthorized(db, consultationId);

  if (!authorized) {
    return NextResponse.json(
      { authorized: false, reason: 'consent_required' },
      { status: 403 },
    );
  }

  return NextResponse.json({ authorized: true });
}
