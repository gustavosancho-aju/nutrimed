import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import { KimiLlmProvider } from '@nutrimed/llm-kimi';
import { FallbackLlmProvider, type ILlmProvider } from '@nutrimed/providers';

/**
 * Provedor dos DOCUMENTOS LONGOS (nota clínica, relatório nutricional, ficha).
 *
 * Kimi K3 é o primário quando há key (decisão 2026-07-21); com as duas keys, o
 * Claude é o RESERVA automático: em 2026-09-24 a conta do Kimi foi suspensa por
 * saldo e nota + ficha pararam em produção com o Claude funcionando ao lado.
 * Retorna `null` sem nenhuma key — cada action decide seu fake de dev.
 *
 * Os documentos usam o SONNET, não o Haiku do board (decisão 2026-09-25): são
 * os textos que o médico mais lê e corrige, e ali qualidade vale mais que
 * latência. O board ao vivo segue no Haiku, onde a velocidade manda.
 */
export const DOCUMENT_MODEL = 'claude-sonnet-5';

export function buildDocumentLlm(): ILlmProvider | null {
  const claude = process.env.ANTHROPIC_API_KEY
    ? new AnthropicLlmProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        personaId: 'aurelio',
        model: DOCUMENT_MODEL,
      })
    : null;
  if (!process.env.KIMI_API_KEY) return claude;

  const kimi = new KimiLlmProvider({
    apiKey: process.env.KIMI_API_KEY,
    personaId: 'aurelio',
    longForm: true,
  });
  if (!claude) return kimi;

  return new FallbackLlmProvider(kimi, claude, (err) => {
    // Só a mensagem do provedor — nunca o prompt (contém dado clínico).
    console.warn(
      '[document-llm] Kimi falhou, usando Claude:',
      err instanceof Error ? err.message : String(err),
    );
  });
}
