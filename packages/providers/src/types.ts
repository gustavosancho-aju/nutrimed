/**
 * Tipos de domínio dos contratos de fornecedores (architecture.md §5/§8).
 *
 * São os tipos que o domínio (E2/E5/E8) troca com os providers, SEM conhecer
 * nenhum vendor concreto (NFR8). Mantidos mínimos e fiéis à arquitetura
 * (Article IV — No Invention): nada de TTS/streaming de vídeo/batch aqui.
 */

/** As 3 personas do board (docs/personas-board.md). */
export type PersonaId = 'aurelio' | 'paulo' | 'yara';

/** Tipo de contribuição da persona (CONTRIBUTION.type — §8). */
export type ContributionType = 'atencao' | 'sugestao' | 'hipotese' | 'sintese';

/** Severidade da contribuição (CONTRIBUTION.severity — §8). */
export type ContributionSeverity = 'normal' | 'critical';

/** Estado de vídeo do catálogo pré-renderizado (ADR-007, §5). */
export type VideoState = 'ouvindo' | 'pensando' | 'sinalizando';

/**
 * Segmento de transcrição emitido pelo STT em streaming (§5).
 * `isFinal=false` ⇒ parcial (pode ser revisado); `true` ⇒ consolidado.
 */
export interface TranscriptSegment {
  readonly text: string;
  readonly isFinal: boolean;
  /** Offsets opcionais em ms desde o início do stream. */
  readonly startMs?: number;
  readonly endMs?: number;
  /** Epoch ms de recepção no cliente — insumo de medição de latência (NFR5, POC 2.5). */
  readonly receivedAtMs?: number;
}

/**
 * Trecho de conhecimento recuperado da KB, sempre escopado por persona (FR21).
 * `source` sustenta a proveniência da auditoria (NFR10 → Story 1.5).
 */
export interface KbChunk {
  readonly id: string;
  readonly personaId: PersonaId;
  readonly text: string;
  readonly source?: string;
  readonly score?: number;
}

/**
 * Contribuição de uma persona, produzida pelo LLM (alinha com CONTRIBUTION §8).
 * Campos de proveniência (`triggeredBy`, `kbSources`) alimentam a auditoria.
 */
export interface PersonaContribution {
  readonly personaId: PersonaId;
  readonly type: ContributionType;
  readonly severity: ContributionSeverity;
  readonly text: string;
  readonly relevanceScore?: number;
  readonly triggeredBy?: string;
  /** Ids dos KbChunk usados como base (proveniência para auditoria). */
  readonly kbSources?: readonly string[];
  /** Versão do modelo que gerou (proveniência NFR10 — Story 1.5). */
  readonly modelVersion?: string;
}

/** Referência a um clipe pré-renderizado do catálogo de vídeo (ADR-007). */
export interface ClipRef {
  readonly personaId: PersonaId;
  readonly state: VideoState;
  readonly url: string;
}
