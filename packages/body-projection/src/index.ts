import { GeminiBodyProjector } from './gemini-projector';
import { OpenAiBodyProjector } from './openai-projector';
import { FakeBodyProjector } from './fake-projector';
import type { IBodyProjector } from './projector';

export {
  type IBodyProjector,
  type BodyProjectionInput,
  type BodyProjectionResult,
  type BodyProjectorErrorKind,
  type PhotoMimeType,
  BodyProjectorError,
  ALLOWED_PHOTO_MIME_TYPES,
  MAX_PHOTO_BYTES,
  base64Bytes,
  bmiFrom,
  sniffImageMime,
  validateProjectionInput,
} from './projector';
export { GeminiBodyProjector, buildPrompt, type GeminiProjectorConfig } from './gemini-projector';
export { OpenAiBodyProjector, type OpenAiProjectorConfig } from './openai-projector';
export { FakeBodyProjector } from './fake-projector';

export interface CreateProjectorOptions {
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

/**
 * Seleciona o gerador conforme o ambiente (degradação graciosa, NFR13):
 * - `BODY_PROJECTOR=fake|gemini|openai` escolhe explicitamente;
 * - sem escolha, `GEMINI_API_KEY` presente ⇒ Gemini (default histórico);
 * - sem key fora de produção ⇒ fake (permite exercitar o fluxo localmente);
 * - produção sem key ⇒ `null` (a UI esconde o recurso e segue no simulador SVG).
 *
 * A OpenAI NUNCA é escolhida implicitamente, mesmo com `OPENAI_API_KEY` no
 * ambiente: essa variável já existe para o STT (@nutrimed/stt-openai), e usá-la
 * como sinal aqui trocaria o provedor de imagem sem ninguém pedir.
 *
 * Atenção: a key precisa estar em `apps/web/.env.local` — o Next NÃO lê o
 * `.env` da raiz, onde ela vive para os scripts.
 */
export function createBodyProjector(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateProjectorOptions = {},
): IBodyProjector | null {
  const extras = {
    ...(env.BODY_PROJECTOR_MODEL ? { model: env.BODY_PROJECTOR_MODEL } : {}),
    ...(options.onUsage ? { onUsage: options.onUsage } : {}),
  };
  const escolha = env.BODY_PROJECTOR;

  if (escolha === 'fake') return new FakeBodyProjector();
  if (escolha === 'openai') {
    return env.OPENAI_API_KEY ? new OpenAiBodyProjector({ apiKey: env.OPENAI_API_KEY, ...extras }) : null;
  }
  if (escolha === 'gemini') {
    return env.GEMINI_API_KEY ? new GeminiBodyProjector({ apiKey: env.GEMINI_API_KEY, ...extras }) : null;
  }

  if (env.GEMINI_API_KEY) return new GeminiBodyProjector({ apiKey: env.GEMINI_API_KEY, ...extras });
  if (env.NODE_ENV !== 'production') return new FakeBodyProjector();
  return null;
}
