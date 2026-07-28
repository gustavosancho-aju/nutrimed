import { GeminiBodyProjector } from './gemini-projector';
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
export { FakeBodyProjector } from './fake-projector';

export interface CreateProjectorOptions {
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

/**
 * Seleciona o gerador conforme o ambiente (degradação graciosa, NFR13):
 * - `BODY_PROJECTOR=fake` força o fake (testes/verificação sem custo);
 * - `GEMINI_API_KEY` presente ⇒ Gemini;
 * - sem key fora de produção ⇒ fake (permite exercitar o fluxo localmente);
 * - produção sem key ⇒ `null` (a UI esconde o recurso e segue no simulador SVG).
 *
 * Atenção: a key precisa estar em `apps/web/.env.local` — o Next NÃO lê o
 * `.env` da raiz, onde ela vive hoje para os scripts.
 */
export function createBodyProjector(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateProjectorOptions = {},
): IBodyProjector | null {
  if (env.BODY_PROJECTOR === 'fake') return new FakeBodyProjector();
  if (env.GEMINI_API_KEY) {
    return new GeminiBodyProjector({
      apiKey: env.GEMINI_API_KEY,
      ...(env.BODY_PROJECTOR_MODEL ? { model: env.BODY_PROJECTOR_MODEL } : {}),
      ...(options.onUsage ? { onUsage: options.onUsage } : {}),
    });
  }
  if (env.NODE_ENV !== 'production') return new FakeBodyProjector();
  return null;
}
