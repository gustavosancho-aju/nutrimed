import { getCurrentUser } from '@/lib/auth';

/**
 * TEMPORÁRIO — smoke test do alerta de produção (observability). Lança um erro
 * de propósito, SÓ para usuário autenticado, para validar a cadeia
 * onRequestError → reportServerError → Telegram de ponta a ponta.
 *
 * REMOVER após o teste (é uma rota que retorna 500 de propósito).
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  throw new Error('🔔 Teste de alerta de produção — pode ignorar (rota de smoke test).');
}
