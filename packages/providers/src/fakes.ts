/**
 * Implementações fake/determinísticas das 4 interfaces (AC2/AC5).
 *
 * Ativo reutilizável por TODAS as stories de E2–E8 (IDS: serão REUSE): permitem
 * desenvolver e testar o domínio sem provider real nem chaves de API, e sem
 * decidir vendor (decisão de POC). Determinísticos por construção.
 */
import type {
  ISttProvider,
  SttSession,
  ILlmProvider,
  LlmCompletionRequest,
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';
import type {
  PersonaId,
  VideoState,
  TranscriptSegment,
  KbChunk,
  PersonaContribution,
  ClipRef,
} from './types';

/**
 * STT fake: emite uma sequência fixa de segmentos (parciais → final).
 * Default: simula a fala sendo refinada até o segmento final.
 */
export class FakeSttProvider implements ISttProvider {
  constructor(private readonly segments: readonly TranscriptSegment[] = DEFAULT_SEGMENTS) {}

  openStream(opts: { lang: 'pt-BR' }): SttSession {
    void opts.lang; // contrato exige PT-BR; o fake é agnóstico ao idioma
    const segments = this.segments;
    let closed = false;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<TranscriptSegment> {
        for (const segment of segments) {
          if (closed) return;
          yield segment;
        }
      },
      async close(): Promise<void> {
        closed = true;
      },
    };
  }
}

const DEFAULT_SEGMENTS: readonly TranscriptSegment[] = [
  { text: 'Paciente', isFinal: false, startMs: 0, endMs: 400 },
  { text: 'Paciente em GLP-1', isFinal: false, startMs: 0, endMs: 900 },
  { text: 'Paciente em GLP-1 com cansaço e platô no peso.', isFinal: true, startMs: 0, endMs: 1500 },
];

/**
 * LLM fake: retorna uma `PersonaContribution` previsível. A persona e o tipo
 * são configuráveis; o texto deriva do transcript para ser verificável em teste.
 */
export class FakeLlmProvider implements ILlmProvider {
  constructor(
    private readonly personaId: PersonaId = 'aurelio',
    private readonly type: PersonaContribution['type'] = 'sugestao',
  ) {}

  async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
    return {
      personaId: this.personaId,
      type: this.type,
      severity: 'normal',
      text: `[${this.personaId}] resposta determinística para: ${req.transcript}`,
      relevanceScore: 0.9,
      triggeredBy: req.transcript,
      kbSources: req.context.map((chunk) => chunk.id),
    };
  }
}

/**
 * Retriever fake: serve chunks de um catálogo em memória, SEMPRE filtrando pelo
 * namespace da persona (FR21). Retorna no máximo `k` itens, de forma determinística.
 */
export class FakeKnowledgeRetriever implements IKnowledgeRetriever {
  private readonly byPersona: ReadonlyMap<PersonaId, readonly KbChunk[]>;

  constructor(catalog: readonly KbChunk[] = DEFAULT_CATALOG) {
    const map = new Map<PersonaId, KbChunk[]>();
    for (const chunk of catalog) {
      const list = map.get(chunk.personaId) ?? [];
      list.push(chunk);
      map.set(chunk.personaId, list);
    }
    this.byPersona = map;
  }

  async retrieve(personaId: PersonaId, _query: string, k: number): Promise<KbChunk[]> {
    const chunks = this.byPersona.get(personaId) ?? [];
    return chunks.slice(0, Math.max(0, k));
  }
}

const DEFAULT_CATALOG: readonly KbChunk[] = [
  { id: 'aurelio-1', personaId: 'aurelio', text: 'Ancoragem clínica e integração do caso.', source: 'seed' },
  { id: 'paulo-1', personaId: 'paulo', text: 'Avaliar PA/FC antes de ajustar dose.', source: 'seed' },
  { id: 'yara-1', personaId: 'yara', text: 'Investigar TSH e T4 livre em platô com cansaço.', source: 'seed' },
];

/**
 * Video fake: resolve um `ClipRef` determinístico por (persona, estado), apontando
 * para uma URL simbólica do catálogo pré-renderizado (ADR-007).
 */
export class FakeVideoAssetProvider implements IVideoAssetProvider {
  getClip(personaId: PersonaId, state: VideoState): ClipRef {
    return { personaId, state, url: `fake://clips/${personaId}/${state}.mp4` };
  }
}
