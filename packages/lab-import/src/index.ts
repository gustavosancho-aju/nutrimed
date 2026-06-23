import { ClaudeLabExtractor } from './claude-extractor';
import { FakeLabExtractor } from './fake-extractor';
import type { ILabExtractor } from './extractor';

export {
  type ILabExtractor,
  type LaudoInput,
  type LaudoKind,
  type ExtractedLaudo,
  KNOWN_FIELDS,
  sanitizeExtraction,
} from './extractor';
export { ClaudeLabExtractor, LabExtractorError, type ClaudeExtractorConfig } from './claude-extractor';
export { FakeLabExtractor } from './fake-extractor';

/**
 * Seleciona o extrator conforme o ambiente (ADR-012, degradação graciosa NFR13):
 * - `LAB_EXTRACTOR=fake` força o fake (testes/verificação local sem custo).
 * - `ANTHROPIC_API_KEY` presente ⇒ Claude (PDF nativo).
 * - sem key fora de produção ⇒ fake (permite exercitar o fluxo localmente).
 * - produção sem key ⇒ `null` (a UI cai para entrada manual).
 */
export function createLabExtractor(env: NodeJS.ProcessEnv = process.env): ILabExtractor | null {
  if (env.LAB_EXTRACTOR === 'fake') return new FakeLabExtractor();
  if (env.ANTHROPIC_API_KEY) return new ClaudeLabExtractor({ apiKey: env.ANTHROPIC_API_KEY });
  if (env.NODE_ENV !== 'production') return new FakeLabExtractor();
  return null;
}
