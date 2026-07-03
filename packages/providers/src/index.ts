// Tipos de domínio dos contratos
export type {
  PersonaId,
  ContributionType,
  ContributionSeverity,
  VideoState,
  TranscriptSegment,
  KbChunk,
  PersonaContribution,
  ClipRef,
} from './types';

// As 4 interfaces de abstração de fornecedores (NFR8)
export type {
  ISttProvider,
  SttSession,
  SttOpenOptions,
  ILlmProvider,
  LlmCompletionRequest,
  TextCompletionRequest,
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';

// Fakes determinísticos (reutilizáveis por E2–E8)
export {
  FakeSttProvider,
  FakeLlmProvider,
  FakeTextCompleter,
  FakeKnowledgeRetriever,
  FakeVideoAssetProvider,
} from './fakes';

// Utilitário de parsing de saída de LLM (strip de cercas de código)
export { stripJsonFences } from './json';
