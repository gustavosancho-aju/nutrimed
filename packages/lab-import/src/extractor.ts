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
  /**
   * Extrai o PAINEL COMPLETO de um laudo laboratorial (E14) — todos os analitos,
   * não só os campos de {@link KNOWN_FIELDS}. Opcional: fonte que não implementa
   * cai no {@link ILabExtractor.extract} legado. NUNCA persiste.
   */
  extractPanel?(input: LaudoInput): Promise<ExtractedPanel>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Painel completo (E14) — um laudo real traz dezenas de analitos; a whitelist
// de 3 campos do E11 descartava o resto em silêncio. Aqui nada é descartado:
// o que o catálogo não reconhece vira analito LIVRE na camada de cima.
// ─────────────────────────────────────────────────────────────────────────────

/** Um resultado histórico que o PRÓPRIO laudo imprime ("Evolução do paciente"). */
export interface ExtractedHistoryPoint {
  /** Data ISO `YYYY-MM-DD` do resultado anterior. */
  readonly measuredAt: string;
  readonly value: number;
}

export interface ExtractedAnalyte {
  /** Nome exatamente como aparece no laudo (rastreabilidade + canonicalização). */
  readonly rawName: string;
  readonly value: number;
  readonly unit?: string;
  /**
   * Texto da faixa de referência que o laudo imprimiu, JÁ escolhido para o
   * paciente (o laudo lista faixas por sexo/idade; o extrator seleciona a
   * aplicável). Interpretado por `parseReferenceRange` em @nutrimed/lab-catalog.
   */
  readonly referenceText?: string;
  /** Resultados anteriores impressos no próprio laudo (opcional). */
  readonly history?: readonly ExtractedHistoryPoint[];
}

export interface ExtractedPanel {
  /** Data da COLETA em ISO `YYYY-MM-DD`, se o laudo a expôs. */
  readonly measuredAt?: string;
  readonly analytes: readonly ExtractedAnalyte[];
  readonly notes?: string;
}

/** Teto de analitos por laudo — bound contra resposta degenerada do modelo. */
const MAX_ANALYTES = 200;
/** Teto de pontos históricos por analito (laudos imprimem ~4). */
const MAX_HISTORY = 20;

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s+/g, ' ').slice(0, max);
  return s || undefined;
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return ISO_DATE.test(s) ? s : undefined;
}

function sanitizeHistory(raw: unknown): ExtractedHistoryPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedHistoryPoint[] = [];
  for (const item of raw.slice(0, MAX_HISTORY)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const measuredAt = toIsoDate(o.measuredAt ?? o.date);
    const value = toNumber(o.value);
    if (measuredAt && value !== null) out.push({ measuredAt, value });
  }
  return out;
}

/**
 * Fronteira de confiança do painel: aceita apenas entradas com NOME e VALOR
 * NUMÉRICO; o resto é descartado. Nunca lança — entrada inválida ⇒ painel vazio
 * (a UI cai para entrada manual, NFR13). Diferente de `sanitizeExtraction`, não
 * há whitelist de nomes: a canonicalização acontece depois, no catálogo, e o
 * que não casar continua válido como analito livre.
 */
export function sanitizePanel(raw: unknown): ExtractedPanel {
  if (!raw || typeof raw !== 'object') return { analytes: [] };
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.analytes) ? obj.analytes : [];

  const analytes: ExtractedAnalyte[] = [];
  const vistos = new Set<string>();
  for (const item of list.slice(0, MAX_ANALYTES)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const rawName = cleanText(o.rawName ?? o.name, 120);
    const value = toNumber(o.value);
    if (!rawName || value === null) continue;
    // Laudos repetem o mesmo exame em páginas diferentes (ex.: SHBG e
    // testosterona aparecem duas vezes neste laudo) — a 1ª leitura vence.
    const chave = rawName.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const unit = cleanText(o.unit, 24);
    const referenceText = cleanText(o.referenceText ?? o.reference, 200);
    const history = sanitizeHistory(o.history);
    analytes.push({
      rawName,
      value,
      ...(unit ? { unit } : {}),
      ...(referenceText ? { referenceText } : {}),
      ...(history.length ? { history } : {}),
    });
  }

  const measuredAt = toIsoDate(obj.measuredAt);
  const notes = cleanText(obj.notes, 500);
  return { analytes, ...(measuredAt ? { measuredAt } : {}), ...(notes ? { notes } : {}) };
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
