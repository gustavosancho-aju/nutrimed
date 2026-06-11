/**
 * As 4 interfaces de abstração de fornecedores (NFR8, ADR-002) — architecture §5.
 *
 * O domínio importa SÓ estes contratos; vendors concretos (E2/E5/E8) os
 * implementam depois, sem refatorar o domínio. Mínimos por design (AC6):
 * Fase 2 (TTS) e Fase 3 (avatar interativo) entram como novas implementações.
 */
import type {
  PersonaId,
  VideoState,
  TranscriptSegment,
  KbChunk,
  PersonaContribution,
  ClipRef,
} from './types';

/**
 * Sessão de STT em streaming: itera segmentos parciais/finais conforme chegam.
 * `close()` encerra a sessão e libera recursos do provider.
 */
export interface SttSession extends AsyncIterable<TranscriptSegment> {
  close(): Promise<void>;
}

/** Speech-to-Text em streaming PT-BR (§5). */
export interface ISttProvider {
  openStream(opts: { lang: 'pt-BR' }): SttSession;
}

/** Requisição de completon do LLM para gerar uma contribuição de persona. */
export interface LlmCompletionRequest {
  readonly system: string;
  readonly context: readonly KbChunk[];
  readonly transcript: string;
}

/** LLM que produz a contribuição de uma persona a partir do contexto recuperado. */
export interface ILlmProvider {
  complete(req: LlmCompletionRequest): Promise<PersonaContribution>;
}

/**
 * Recuperação de conhecimento escopada por persona (FR21): retorna SÓ chunks do
 * namespace daquela persona — impede uma persona de "invadir" outra especialidade.
 */
export interface IKnowledgeRetriever {
  retrieve(personaId: PersonaId, query: string, k: number): Promise<KbChunk[]>;
}

/**
 * Catálogo de vídeo pré-renderizado (ADR-007): retorna o clipe para (persona, estado).
 * NÃO é streaming de avatar em tempo real (isso seria Fase 3 — AC6).
 */
export interface IVideoAssetProvider {
  getClip(personaId: PersonaId, state: VideoState): ClipRef;
}
