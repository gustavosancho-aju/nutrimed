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
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';

// Fakes determinísticos (reutilizáveis por E2–E8)
export {
  FakeSttProvider,
  FakeLlmProvider,
  FakeKnowledgeRetriever,
  FakeVideoAssetProvider,
} from './fakes';
