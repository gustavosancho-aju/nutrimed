/**
 * Extração de laudos (E11 Fase 4 / ADR-012). A IA produz apenas um RASCUNHO
 * estruturado — a persistência exige confirmação do médico (gate humano
 * obrigatório, implementado na UI da Story 11.10). Aqui não há escrita no banco.
 *
 * O extrator é PLUGÁVEL (NFR8/ADR-002): a fonte (Claude, futuro Document AI,
 * Bedrock/Vertex) é trocável sem mudar o resto. `sanitizeExtraction` é a
 * fronteira de confiança: só campos clínicos conhecidos e numéricos passam.
 */

export type LaudoKind = 'body' | 'lab';

/** Campos numéricos aceitos por tipo de laudo (whitelist — nada além disto entra). */
export const KNOWN_FIELDS: Record<LaudoKind, readonly string[]> = {
  body: [
    'peso',
    'massaMuscular',
    'massaGordura',
    'cintura',
    'imc',
    'pgc',
    'aguaCorporal',
    'gorduraVisceral',
    'tmb',
  ],
  lab: ['ldl', 'hba1c', 'insulina'],
};

export interface ExtractedLaudo {
  readonly kind: LaudoKind;
  /** Data da medição em ISO `YYYY-MM-DD`, se o laudo a expôs. */
  readonly measuredAt?: string;
  /** Valores reconhecidos (só campos de KNOWN_FIELDS[kind], numéricos). */
  readonly values: Record<string, number>;
  /** Observações do extrator (ex.: campos ilegíveis) — informativo. */
  readonly notes?: string;
}

/** A entrada de um PDF para o extrator (base64 do conteúdo). */
export interface LaudoInput {
  readonly base64: string;
  readonly filename?: string;
}

export interface ILabExtractor {
  /** Versão do modelo/fonte — proveniência da auditoria na confirmação (NFR10). */
  readonly modelVersion?: string;
  /** Extrai um rascunho estruturado do PDF. NUNCA persiste. */
  extract(input: LaudoInput, kind: LaudoKind): Promise<ExtractedLaudo>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fronteira de confiança: converte a saída crua (do modelo ou de um fake) num
 * ExtractedLaudo seguro. Mantém apenas campos conhecidos do `kind` com valor
 * numérico finito; descarta o resto. Nunca lança — entrada inválida ⇒ rascunho
 * vazio (a UI cai para entrada manual — NFR13).
 */
export function sanitizeExtraction(raw: unknown, kind: LaudoKind): ExtractedLaudo {
  const allowed = KNOWN_FIELDS[kind];
  const out: Record<string, number> = {};
  let measuredAt: string | undefined;
  let notes: string | undefined;

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const src = (obj.values && typeof obj.values === 'object' ? obj.values : obj) as Record<
      string,
      unknown
    >;
    for (const field of allowed) {
      const v = src[field];
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
      if (Number.isFinite(n)) out[field] = n;
    }
    if (typeof obj.measuredAt === 'string' && ISO_DATE.test(obj.measuredAt.trim())) {
      measuredAt = obj.measuredAt.trim();
    }
    if (typeof obj.notes === 'string' && obj.notes.trim()) notes = obj.notes.trim();
  }

  return { kind, values: out, ...(measuredAt ? { measuredAt } : {}), ...(notes ? { notes } : {}) };
}
