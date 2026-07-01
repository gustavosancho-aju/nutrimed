/**
 * Estimativa nutricional por FOTO de prato (E12 / ADR-015). A IA produz apenas
 * uma ESTIMATIVA APROXIMADA (não medida clínica, não prescrição) — a incerteza
 * é declarada em `confidence`. As metas são humanas (nutricionista). Aqui não há
 * persistência: o registro auditado é feito por `@nutrimed/patients`.
 *
 * O estimador é PLUGÁVEL (NFR8/ADR-002): a fonte (Claude, futuro outro modelo/
 * canal) é trocável sem mudar o resto. `sanitizeFoodEstimate` é a fronteira de
 * confiança: só nutrientes conhecidos, numéricos e não-negativos passam. Espelha
 * o padrão de `@nutrimed/lab-import` (ADR-012).
 */

/** Nutrientes aceitos (whitelist — nada além disto entra). */
export const KNOWN_NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat'] as const;
export type Nutrient = (typeof KNOWN_NUTRIENTS)[number];

/** Confiança declarada da estimativa (incerteza explícita — ADR-015). */
export type FoodConfidence = 'low' | 'medium' | 'high';

export interface FoodEstimate {
  /** Estimativa dos macros do prato (kcal total; proteína/carbo/gordura em g). */
  readonly values: Record<Nutrient, number>;
  readonly confidence: FoodConfidence;
  /** Alimentos reconhecidos (ex.: "arroz, feijão, frango"). Informativo. */
  readonly itemsLabel?: string;
  /** Observações do estimador (ex.: porção incerta) — informativo. */
  readonly notes?: string;
}

/** Entrada: a foto do prato (base64) e seu tipo de mídia. */
export interface FoodImageInput {
  readonly base64: string;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly filename?: string;
}

export interface IFoodEstimator {
  /** Versão do modelo/fonte — proveniência da auditoria no registro (NFR10). */
  readonly modelVersion?: string;
  /** Estima os nutrientes da foto. NUNCA persiste. */
  estimate(input: FoodImageInput): Promise<FoodEstimate>;
}

const VALID_CONFIDENCE: readonly string[] = ['low', 'medium', 'high'];

/**
 * Fronteira de confiança: converte a saída crua (do modelo ou de um fake) num
 * FoodEstimate seguro. Mantém apenas nutrientes conhecidos com valor numérico
 * finito e não-negativo (default 0); `confidence` inválida ⇒ 'low'. Nunca lança
 * — entrada inválida ⇒ estimativa degradada (zeros, confiança baixa).
 */
export function sanitizeFoodEstimate(raw: unknown): FoodEstimate {
  const values: Record<Nutrient, number> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let confidence: FoodConfidence = 'low';
  let itemsLabel: string | undefined;
  let notes: string | undefined;

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const src = (obj.values && typeof obj.values === 'object' ? obj.values : obj) as Record<
      string,
      unknown
    >;
    for (const nutrient of KNOWN_NUTRIENTS) {
      const v = src[nutrient];
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
      if (Number.isFinite(n) && n >= 0) values[nutrient] = n;
    }
    if (typeof obj.confidence === 'string' && VALID_CONFIDENCE.includes(obj.confidence.trim().toLowerCase())) {
      confidence = obj.confidence.trim().toLowerCase() as FoodConfidence;
    }
    if (typeof obj.itemsLabel === 'string' && obj.itemsLabel.trim()) itemsLabel = obj.itemsLabel.trim();
    if (typeof obj.notes === 'string' && obj.notes.trim()) notes = obj.notes.trim();
  }

  return { values, confidence, ...(itemsLabel ? { itemsLabel } : {}), ...(notes ? { notes } : {}) };
}
