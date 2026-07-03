/**
 * Resultado tipado das server actions (E2/E3 — confiabilidade da consulta ao vivo).
 *
 * Em produção o Next.js MASCARA a mensagem de `Error` lançado em server actions
 * (o cliente recebe um texto genérico em inglês). Por isso as actions do fluxo
 * ao vivo NUNCA lançam: retornam `ActionResult` e o cliente mapeia `code` para
 * uma mensagem pt-BR acionável (ACTION_ERROR_MESSAGES).
 */

export type ActionErrorCode =
  | 'unauthenticated'
  | 'consent-required'
  | 'stt-missing'
  | 'no-transcript'
  | 'invalid-input'
  | 'internal';

export type ActionResult = { ok: true } | { ok: false; code: ActionErrorCode; detail?: string };

/** Mensagens pt-BR acionáveis por código — únicas exibidas ao médico. */
export const ACTION_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  unauthenticated: 'Sessão expirada — faça login novamente.',
  'consent-required':
    'Consentimento de gravação não registrado — registre o consentimento do paciente (botão no topo da página) e tente novamente.',
  'stt-missing': 'O serviço de transcrição não está configurado no servidor — contate o suporte.',
  'no-transcript': 'Sem transcrição nesta sessão — inicie a consulta ao vivo antes de gerar a nota.',
  'invalid-input': 'Dados da requisição incompletos — recarregue a página e tente de novo.',
  internal: 'Falha inesperada ao iniciar a consulta ao vivo — tente novamente; se persistir, abra o Diagnóstico.',
};

/**
 * Classifica um erro lançado pelo runtime em um código de ação. Usa `err.name`
 * (e não instanceof) porque a classe pode atravessar fronteiras de bundle.
 */
export function toActionResult(err: unknown): ActionResult {
  if (err instanceof Error) {
    if (err.name === 'ConsentRequiredError') return { ok: false, code: 'consent-required' };
    if (err.name === 'DeepgramSttError' && (err as { kind?: string }).kind === 'config') {
      return { ok: false, code: 'stt-missing' };
    }
    if (/DEEPGRAM_API_KEY/.test(err.message)) return { ok: false, code: 'stt-missing' };
    return { ok: false, code: 'internal', detail: err.message };
  }
  return { ok: false, code: 'internal' };
}
