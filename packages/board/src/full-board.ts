import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '@nutrimed/db';
import { writeAudit } from '@nutrimed/audit';
import type { ILlmProvider, PersonaContribution, PersonaId } from '@nutrimed/providers';
import type { ConsultationSession } from '@nutrimed/session';
import {
  TriggerDetector,
  scoreMatch,
  BoardGatekeeper,
  type Candidate,
  type GatekeeperConfig,
  type TriggerMatch,
} from '@nutrimed/engines';
import { PersonaReasoner, PERSONA_PROFILES, buildPersonaSystem } from '@nutrimed/kb';
import type { IKnowledgeRetriever } from '@nutrimed/providers';

/**
 * Board COMPLETO (E6 — Stories 6.1/6.2/6.3): as 3 personas simultâneas (FR2)
 * integrando motores (E4) e RAG (E5), com síntese do Aurélio (FR6/FR18) e
 * divergência transparente (FR7).
 *
 * Pipeline por segmento FINAL: TriggerDetector → score → BoardGatekeeper
 * (limiar/dedup/pausa/rate-limit) → PersonaReasoner (KB escopada) → auditoria
 * (1.5) → evento. LLM SÓ roda para candidato liberado (T2).
 */

export interface FullBoardEvent {
  readonly type: 'contribution';
  readonly id: string;
  readonly consultationId: string;
  readonly contribution: PersonaContribution;
  /** Personas do card (>1 ⇒ consolidado — FR11 nível board). */
  readonly personaIds: readonly PersonaId[];
  /** Divergência transparente entre personas no mesmo tópico (FR7). */
  readonly divergent: boolean;
  readonly triggeredBy: string;
  readonly at: number;
}

export type FullBoardListener = (event: FullBoardEvent) => void;

export interface FullBoardConfig extends GatekeeperConfig {
  /** Intervalo do tick de release (pausa/fila). Default 1000ms. */
  readonly tickMs?: number;
  /** Síntese automática: contribuições mínimas de personas distintas (default 2). */
  readonly synthesisMinPersonas?: number;
  /** Silêncio p/ síntese automática (default 12s). */
  readonly synthesisQuietMs?: number;
  readonly now?: () => number;
  /** Telemetria (E10): decisão do gate por candidato (calibração O2/O3). */
  readonly onDecision?: (kind: string) => void;
  /** Telemetria (E10): latência gatilho→publicação por contribuição (§11). */
  readonly onContributionLatency?: (latencyMs: number) => void;
}

interface RoundEntry {
  readonly contribution: PersonaContribution;
  readonly topicKey: string;
}

export class FullBoardOrchestrator {
  private readonly listeners = new Set<FullBoardListener>();
  private readonly detector = new TriggerDetector();
  private readonly gate: BoardGatekeeper;
  private readonly reasoner: PersonaReasoner;
  private readonly recentFinals: string[] = [];
  private readonly round: RoundEntry[] = [];
  /** Tipos por tópico p/ detecção de divergência (FR7). */
  private readonly topicTypes = new Map<string, Map<PersonaId, string>>();
  private unsubscribe: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastContributionAt = 0;
  private synthesized = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly config: Required<Pick<FullBoardConfig, 'tickMs' | 'synthesisMinPersonas' | 'synthesisQuietMs'>>;
  private readonly config2: Pick<FullBoardConfig, 'onDecision' | 'onContributionLatency'>;

  constructor(
    private readonly db: SqlExecutor,
    private readonly session: ConsultationSession,
    private readonly llm: ILlmProvider,
    retriever: IKnowledgeRetriever,
    config: FullBoardConfig = {},
  ) {
    this.gate = new BoardGatekeeper(config);
    this.reasoner = new PersonaReasoner(retriever, llm);
    this.now = config.now ?? Date.now;
    this.config = {
      tickMs: config.tickMs ?? 1000,
      synthesisMinPersonas: config.synthesisMinPersonas ?? 2,
      synthesisQuietMs: config.synthesisQuietMs ?? 12_000,
    };
    this.config2 = { onDecision: config.onDecision, onContributionLatency: config.onContributionLatency };
  }

  /** Liga as 3 personas sobre o stream (FR2) + tick de release/síntese. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.subscribe((event) => {
      if (event.type !== 'segment' || !event.segment.isFinal) return;
      const text = event.segment.text;
      const at = this.now();
      this.gate.pauseGate.onSpeech(at);
      this.pending = this.pending.then(() => this.onFinalSegment(text, at));
    });
    this.ticker = setInterval(() => {
      this.pending = this.pending.then(() => this.tick());
    }, this.config.tickMs);
    this.ticker.unref?.();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.listeners.clear();
  }

  subscribe(listener: FullBoardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  flush(): Promise<void> {
    return this.pending;
  }

  /** Síntese SOB DEMANDA (FR18) — além da automática. */
  async synthesizeNow(): Promise<void> {
    this.pending = this.pending.then(() => this.synthesize('on-demand'));
    return this.pending;
  }

  private async onFinalSegment(text: string, at: number): Promise<void> {
    this.recentFinals.push(text);
    if (this.recentFinals.length > 8) this.recentFinals.shift();

    // 3 personas monitoram o MESMO segmento — sem invocação (FR2)
    for (const match of this.detector.detect(text, at)) {
      const candidate = toCandidate(match);
      const decision = this.gate.submit(candidate, at);
      this.config2.onDecision?.(decision.kind);
      if (decision.kind === 'deliver') await this.produce(decision.candidate);
    }
  }

  private async tick(): Promise<void> {
    const now = this.now();
    for (const candidate of this.gate.release(now)) {
      this.config2.onDecision?.('deliver'); // liberado da pausa/fila (E10)
      await this.produce(candidate);
    }
    // síntese automática ao fim da rodada (FR6): atividade + silêncio prolongado
    const distinct = new Set(this.round.map((r) => r.contribution.personaId));
    if (
      !this.synthesized &&
      distinct.size >= this.config.synthesisMinPersonas &&
      this.lastContributionAt > 0 &&
      now - this.lastContributionAt >= this.config.synthesisQuietMs
    ) {
      await this.synthesize('auto');
    }
  }

  private async produce(candidate: Candidate): Promise<void> {
    try {
      const contribution = await this.reasoner.reason({
        personaId: candidate.personaId,
        query: candidate.segmentText,
        transcript: this.recentFinals.join(' '),
      });
      const divergent = this.registerAndCheckDivergence(candidate, contribution);
      const eventId = randomUUID();
      await writeAudit(this.db, eventId, {
        triggeredBy: candidate.triggerId,
        kbSources: [...(contribution.kbSources ?? [])],
        modelVersion: contribution.modelVersion ?? 'unknown',
      });
      this.round.push({ contribution, topicKey: candidate.topicKey });
      this.lastContributionAt = this.now();
      this.synthesized = false;
      this.emit({
        type: 'contribution',
        id: eventId,
        consultationId: this.session.consultationId,
        contribution: { ...contribution, type: candidate.type, severity: candidate.severity },
        personaIds: candidate.personaIds,
        divergent,
        triggeredBy: candidate.triggerId,
        at: this.now(),
      });
      this.config2.onContributionLatency?.(this.now() - candidate.at);
    } catch {
      // falha de LLM/auditoria não derruba a consulta (§3.1) — candidato é perdido
    }
  }

  /** FR7: tipos conflitantes de personas distintas no mesmo tópico ⇒ divergência. */
  private registerAndCheckDivergence(candidate: Candidate, contribution: PersonaContribution): boolean {
    const types = this.topicTypes.get(candidate.topicKey) ?? new Map<PersonaId, string>();
    types.set(candidate.personaId, candidate.type);
    this.topicTypes.set(candidate.topicKey, types);
    void contribution;
    const distinctTypes = new Set(types.values());
    return types.size > 1 && distinctTypes.size > 1;
  }

  /** FR6/FR18 — Aurélio integra a rodada e devolve a decisão ao médico. */
  private async synthesize(trigger: 'auto' | 'on-demand'): Promise<void> {
    if (this.round.length === 0) return;
    const entries = [...this.round];
    try {
      const summary = entries
        .map((e) => `- ${PERSONA_PROFILES[e.contribution.personaId].displayName}: ${e.contribution.text}`)
        .join('\n');
      const synthesis = await this.llm.complete({
        system:
          buildPersonaSystem(PERSONA_PROFILES.aurelio) +
          ' Agora seu papel é o de SÍNTESE: integre as contribuições do board abaixo numa recomendação única e curta. ' +
          'Se houver divergência entre os colegas, exponha-a com transparência e modere. ' +
          'Termine SEMPRE devolvendo a decisão ao médico (ex.: "a conduta é sua").',
        context: [],
        transcript: `Transcrição recente: ${this.recentFinals.join(' ')}\n\nContribuições do board:\n${summary}`,
      });
      const kbSources = entries.flatMap((e) => e.contribution.kbSources ?? []);
      const eventId = randomUUID();
      await writeAudit(this.db, eventId, {
        triggeredBy: `sintese-${trigger}`,
        kbSources: [...new Set(kbSources)],
        modelVersion: synthesis.modelVersion ?? 'unknown',
      });
      this.round.length = 0; // rodada fecha com a síntese
      this.synthesized = true;
      this.emit({
        type: 'contribution',
        id: eventId,
        consultationId: this.session.consultationId,
        contribution: { ...synthesis, personaId: 'aurelio', type: 'sintese', severity: 'normal' },
        personaIds: ['aurelio'],
        divergent: false,
        triggeredBy: `sintese-${trigger}`,
        at: this.now(),
      });
    } catch {
      // síntese falhou — rodada permanece p/ nova tentativa
    }
  }

  private emit(event: FullBoardEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function toCandidate(match: TriggerMatch): Candidate {
  return {
    id: randomUUID(),
    personaId: match.trigger.personaId,
    personaIds: [match.trigger.personaId],
    triggerId: match.trigger.id,
    topicKey: match.trigger.id.replace(/^[a-z]+-/, ''), // tópico sem o prefixo da persona
    type: match.trigger.typeHint,
    severity: match.trigger.severityHint,
    score: scoreMatch(match),
    segmentText: match.segmentText,
    at: match.at,
  };
}
