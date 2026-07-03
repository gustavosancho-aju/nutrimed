import type {
  IKnowledgeRetriever,
  ILlmProvider,
  PersonaContribution,
  PersonaId,
} from '@nutrimed/providers';

/**
 * Persona Reasoner (Story 5.3 — FR3/FR21/T6).
 *
 * Após o Gate (E4) aprovar um candidato: recupera KB SÓ do namespace da
 * persona → chama `ILlmProvider` com prompt RESTRITO ao escopo → contribuição
 * PT-BR ancorada no contexto. `kbSources` = ids dos chunks usados
 * (proveniência → auditoria 1.5). Só conhece interfaces (NFR8).
 */

export interface PersonaProfile {
  readonly personaId: PersonaId;
  readonly displayName: string;
  /** Escopo da especialidade (KB seed / personas-board.md). */
  readonly scope: string;
}

/** Escopos das 3 personas — derivados de personas-knowledge-base-seed.md. */
export const PERSONA_PROFILES: Record<PersonaId, PersonaProfile> = {
  aurelio: {
    personaId: 'aurelio',
    displayName: 'Dr. Aurélio Bastos (Nutrologia)',
    scope:
      'terapia nutricional, composição corporal, deficiências nutricionais, visão integral do paciente e condução geral do caso',
  },
  paulo: {
    personaId: 'paulo',
    displayName: 'Dr. Paulo Tavares (Cardiologia)',
    scope:
      'risco cardiovascular, hipertensão, dislipidemia, segurança cardiovascular de fármacos (GLP-1, simpaticomiméticos, termogênicos) e cardiologia preventiva',
  },
  yara: {
    personaId: 'yara',
    displayName: 'Dra. Yara Nakamura (Endocrinologia)',
    scope:
      'eixo tireoidiano, resistência insulínica, GLP-1 (mecanismo), reposições hormonais, diabetes e metabolismo',
  },
};

/** System prompt restrito por persona — anti-extrapolação (T6), tom de sugestão (§4.4). */
export function buildPersonaSystem(profile: PersonaProfile): string {
  return (
    `Você é ${profile.displayName}, membro de um board de apoio à decisão para nutrólogos. ` +
    `Seu escopo é ESTRITAMENTE: ${profile.scope}. ` +
    `REGRAS INEGOCIÁVEIS: (1) NUNCA opine fora do seu escopo — se o tema pertence a outra especialidade, ` +
    `não contribua sobre ele; (2) ancore-se APENAS no contexto de conhecimento fornecido — não invente diretrizes; ` +
    `(3) responda em português do Brasil, em 1-3 frases, em tom de sugestão ("vale checar", "considere"), ` +
    `nunca de comando — a conduta é sempre do médico; ` +
    `(4) NÃO repita contribuições já feitas pelo board (mesmo com outras palavras) — analise a PROGRESSÃO ` +
    `da conversa e só contribua com o que é NOVO e útil agora.`
  );
}

/** Contribuição anterior do board (B1 — memória anti-repetição). */
export interface PriorContribution {
  readonly personaId: PersonaId;
  readonly text: string;
}

export interface ReasonInput {
  readonly personaId: PersonaId;
  /** Texto do gatilho/segmento que motivou (query do retrieve). */
  readonly query: string;
  /** Janela recente da transcrição (contexto da conversa). */
  readonly transcript: string;
  /** Chunks a recuperar (default 3). */
  readonly k?: number;
  /** B1: contribuições já exibidas nesta consulta (o modelo não deve repeti-las). */
  readonly previousContributions?: readonly PriorContribution[];
  /** B3: bloco compacto do ESTADO DO CASO (CaseStateTracker) — progressão da consulta inteira. */
  readonly caseState?: string;
}

export class PersonaReasoner {
  constructor(
    private readonly retriever: IKnowledgeRetriever,
    private readonly llm: ILlmProvider,
  ) {}

  async reason(input: ReasonInput): Promise<PersonaContribution> {
    const profile = PERSONA_PROFILES[input.personaId];
    // FR21: recuperação SÓ no namespace da persona
    const context = await this.retriever.retrieve(input.personaId, input.query, input.k ?? 3);
    const priors = (input.previousContributions ?? []).map(
      (c) => `[${PERSONA_PROFILES[c.personaId].displayName}] ${c.text}`,
    );
    const contribution = await this.llm.complete({
      system: buildPersonaSystem(profile),
      context,
      // B3: o estado do caso dá ao modelo a PROGRESSÃO da consulta inteira,
      // não só a janela curta de transcript
      transcript: input.caseState ? `${input.caseState}\n\n${input.transcript}` : input.transcript,
      priorContributions: priors,
      allowSkip: true, // sem nada novo, o modelo devolve {"skip":true} e nada é exibido
    });
    if (contribution.skip) return { ...contribution, personaId: input.personaId };
    return {
      ...contribution,
      personaId: input.personaId, // a persona é decisão do board, não do modelo
      kbSources: context.map((c) => c.id), // proveniência → auditoria (1.5)
    };
  }
}
