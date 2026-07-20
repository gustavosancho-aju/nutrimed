import { stripJsonFences, type ILlmProvider, type PersonaId } from '@nutrimed/providers';
import { PERSONA_PROFILES } from '@nutrimed/kb';

/**
 * Parecer final do board (briefing do piloto 2026-07-19): ao invés de (ou além
 * de) contribuir AO VIVO — "atrapalha a consulta, tira o foco" — cada persona
 * revisa a transcrição COMPLETA já encerrada e devolve um parecer estruturado:
 * o que faltou perguntar, exames a considerar solicitar, condutas a considerar.
 *
 * Reaproveita o padrão deliberativo do case review (B4): 1 chamada de texto
 * livre por persona, output JSON validado defensivamente — o modelo sugere, o
 * código decide. Sem trigger/gate (a consulta já acabou); sem invocação de KB
 * (parecer é sobre a CONVERSA, não sobre uma busca pontual).
 */

export interface FinalReviewSection {
  readonly personaId: PersonaId;
  readonly faltouPerguntar: readonly string[];
  readonly examesSolicitar: readonly string[];
  readonly condutas: readonly string[];
  readonly modelVersion?: string;
}

const PERSONA_ORDER: readonly PersonaId[] = ['aurelio', 'paulo', 'yara'];

/** Teto de linhas de transcrição enviadas ao modelo (custo — consultas longas). */
const MAX_TRANSCRIPT_LINES = 300;

function systemFor(personaId: PersonaId): string {
  const profile = PERSONA_PROFILES[personaId];
  return (
    `Você é ${profile.displayName}, membro de um board de apoio à decisão para nutrólogos. ` +
    `Seu escopo é ESTRITAMENTE: ${profile.scope}. ` +
    'A CONSULTA JÁ TERMINOU. Você está revisando a transcrição completa, nos bastidores — ' +
    'não durante o atendimento. Dê seu parecer final, dentro do seu escopo, em 3 categorias: ' +
    '(a) o que faltou perguntar ao paciente; (b) exames que vale considerar solicitar; ' +
    '(c) condutas que vale considerar discutir com o paciente. ' +
    'REGRAS: (1) baseie-se SOMENTE no que foi efetivamente dito na transcrição — não presuma ' +
    'medicações, exames ou condutas que ninguém mencionou; (2) fique estritamente no seu escopo — ' +
    'se um tema pertence a outra especialidade, não opine sobre ele; (3) sem nada relevante numa ' +
    'categoria, devolva a lista vazia (não invente para preencher); (4) tom de sugestão ' +
    '("vale checar", "considere") — a conduta final é sempre do médico; (5) português do Brasil, ' +
    'frases curtas e diretas, no máximo 4 itens por categoria. ' +
    'Responda APENAS com JSON válido (sem cercas de código): ' +
    '{"faltouPerguntar":["..."],"examesSolicitar":["..."],"condutas":["..."]}.'
  );
}

/** Parse defensivo: campos ausentes/malformados viram lista vazia, nunca exceção. */
export function parseFinalReviewSection(
  raw: string,
): Pick<FinalReviewSection, 'faltouPerguntar' | 'examesSolicitar' | 'condutas'> | null {
  const cleaned = stripJsonFences(raw);
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
        : [];
    return {
      faltouPerguntar: arr(obj.faltouPerguntar),
      examesSolicitar: arr(obj.examesSolicitar),
      condutas: arr(obj.condutas),
    };
  } catch {
    return null;
  }
}

/**
 * Roda o parecer final das 3 personas em paralelo. Provider sem `completeText`
 * (fake antigo) ⇒ retorna lista vazia (degradação graciosa, sem exceção).
 * Uma persona que falhar (LLM/parse) simplesmente não aparece no resultado —
 * as demais não são derrubadas por ela.
 */
export async function runFinalReview(
  llm: ILlmProvider,
  transcriptFinals: readonly string[],
  caseStateBlock?: string,
): Promise<FinalReviewSection[]> {
  if (typeof llm.completeText !== 'function') return [];
  const lines = transcriptFinals.slice(-MAX_TRANSCRIPT_LINES);
  const transcript = lines.length > 0 ? lines.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(sem transcrição)';
  const results = await Promise.all(
    PERSONA_ORDER.map(async (personaId): Promise<FinalReviewSection | null> => {
      try {
        const res = await llm.completeText!({
          system: systemFor(personaId),
          prompt: `${caseStateBlock ? `${caseStateBlock}\n\n` : ''}Transcrição completa da consulta:\n${transcript}`,
          maxTokens: 500,
        });
        const parsed = parseFinalReviewSection(res.text);
        if (!parsed) return null;
        return { personaId, ...parsed, modelVersion: res.modelVersion };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is FinalReviewSection => r !== null);
}
