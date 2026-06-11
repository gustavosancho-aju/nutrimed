import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '@nutrimed/db';
import { writeAudit } from '@nutrimed/audit';
import type { ILlmProvider, PersonaContribution, PersonaId } from '@nutrimed/providers';
import type { ConsultationSession } from '@nutrimed/session';

/**
 * Board Orchestrator MÍNIMO (Story 3.1 — walking skeleton, FR2/FR3 parciais).
 *
 * 1 persona ativa desde o início, 1 gatilho clínico HARDCODED sobre segmentos
 * finais da transcrição (2.3) → 1 chamada `ILlmProvider` → 1 contribuição
 * publicada no stream de eventos do board (consumida pelo WS gateway — 3.2).
 *
 * Fino por design (epic-03): SEM Trigger Detector genérico, score, rate-limit
 * ou dedup reais (E4); SEM RAG (E5); SEM 3 personas/síntese (E6). Apenas um
 * cooldown anti-spam por termo de gatilho.
 *
 * Compliance (NFR10): TODA contribuição publicada gera entrada de auditoria
 * (Story 1.5) com proveniência — gatilho, kbSources (vazio no skeleton) e
 * versão de modelo. O id do evento é o `contribution_id` da trilha
 * (a entidade CONTRIBUTION persistida nasce no E4).
 */

/** Gatilho do Dr. Paulo (cardio) — personas-knowledge-base-seed.md: menção a
 * GLP-1/anfepramona/sibutramina/termogênicos → alerta de segurança CV. */
export const PAULO_CV_TRIGGER: ClinicalTrigger = {
  id: 'paulo-seguranca-cv-farmacos',
  personaId: 'paulo',
  pattern: /GLP-?1|semaglutida|liraglutida|tirzepatida|sibutramina|anfepramona|termog[êe]nico|palpita[çc][ãa]o/i,
  systemPrompt:
    'Você é o Dr. Paulo, cardiologista de um board de apoio à decisão para nutrólogos. ' +
    'Ao detectar menção a fármacos com implicação cardiovascular (GLP-1, sibutramina, anfepramona, termogênicos) ' +
    'ou sintomas CV, produza UMA contribuição curta de segurança cardiovascular em tom de sugestão ' +
    '("vale checar", "considere"), nunca de comando. A conduta é sempre do médico.',
};

export interface ClinicalTrigger {
  readonly id: string;
  readonly personaId: PersonaId;
  readonly pattern: RegExp;
  readonly systemPrompt: string;
}

export interface BoardContributionEvent {
  readonly type: 'contribution';
  readonly id: string;
  readonly consultationId: string;
  readonly contribution: PersonaContribution;
  readonly triggeredBy: string;
  readonly at: number;
}

export type BoardListener = (event: BoardContributionEvent) => void;

export interface OrchestratorOptions {
  readonly trigger?: ClinicalTrigger;
  /** Janela de transcript (nº de segmentos finais recentes) enviada ao LLM. */
  readonly transcriptWindow?: number;
  /** Cooldown por gatilho em ms (anti-spam — AC5). */
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export class BoardOrchestrator {
  private readonly listeners = new Set<BoardListener>();
  private readonly recentFinals: string[] = [];
  private lastFiredAt = -Infinity;
  private unsubscribe: (() => void) | null = null;
  private readonly trigger: ClinicalTrigger;
  private readonly window: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  /** Encadeia processamentos p/ ordem determinística e await em teste. */
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: SqlExecutor,
    private readonly session: ConsultationSession,
    private readonly llm: ILlmProvider,
    opts: OrchestratorOptions = {},
  ) {
    this.trigger = opts.trigger ?? PAULO_CV_TRIGGER;
    this.window = opts.transcriptWindow ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Liga a persona desde o início da transcrição (FR2 — AC1/AC2). */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.subscribe((event) => {
      if (event.type !== 'segment' || !event.segment.isFinal) return;
      const text = event.segment.text;
      this.pending = this.pending.then(() => this.onFinalSegment(text));
    });
  }

  /** Encerramento limpo junto com a sessão (AC6). */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  subscribe(listener: BoardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Aguarda os processamentos em voo (testes/encerramento). */
  flush(): Promise<void> {
    return this.pending;
  }

  private async onFinalSegment(text: string): Promise<void> {
    this.recentFinals.push(text);
    if (this.recentFinals.length > this.window) this.recentFinals.shift();

    if (!this.trigger.pattern.test(text)) return; // sem gatilho → silêncio (AC7)
    if (this.now() - this.lastFiredAt < this.cooldownMs) return; // cooldown (AC5)
    this.lastFiredAt = this.now();

    const transcript = this.recentFinals.join(' ');
    try {
      const contribution = await this.llm.complete({
        system: this.trigger.systemPrompt,
        context: [], // RAG entra no E5 — skeleton usa contexto mínimo
        transcript,
      });

      const eventId = randomUUID();
      // NFR10: auditoria ANTES de publicar — contribuição sem trilha não existe (AC4)
      await writeAudit(this.db, eventId, {
        triggeredBy: this.trigger.id,
        kbSources: [...(contribution.kbSources ?? [])],
        modelVersion: contribution.modelVersion ?? 'unknown',
      });

      const event: BoardContributionEvent = {
        type: 'contribution',
        id: eventId,
        consultationId: this.session.consultationId,
        contribution,
        triggeredBy: this.trigger.id,
        at: this.now(),
      };
      for (const listener of this.listeners) listener(event);
    } catch {
      // skeleton: falha de LLM/auditoria não derruba a consulta (frontend-spec §3.1);
      // contribuição simplesmente não é publicada. Observabilidade real é E10.
    }
  }
}
