/**
 * Leitura da FAIXA DE REFERÊNCIA que o próprio laudo imprimiu ao lado do
 * resultado ("Masculino: de 3,5 a 8,5 mg/dL", "Inferior a 35 U/L", "Menor que
 * 5,7%").
 *
 * Decisão de produto (E14): o NutriMed NÃO mantém faixas clínicas próprias. A
 * faixa é do laboratório que assinou o exame, já ajustada por sexo/idade, e é
 * guardada POR MEDIÇÃO — se o lab mudar a referência (acontece: este laudo
 * avisa de mudanças em 2024 e 2025), o histórico antigo continua mostrando a
 * faixa que valia na época. Faixa é apoio visual; a interpretação é do médico.
 *
 * Tudo aqui é puro e não lança: texto que não casar vira faixa vazia, e o
 * gráfico simplesmente não desenha banda.
 */

export interface ReferenceRange {
  /** Limite inferior, quando o texto o define. */
  readonly min?: number;
  /** Limite superior, quando o texto o define. */
  readonly max?: number;
}

/**
 * Converte um número escrito em pt-BR ou en-US. Com vírgula presente, a vírgula
 * é o separador decimal e os pontos são milhar ("1.480,5"); sem vírgula, o
 * ponto é decimal ("8.6"). NaN ⇒ null.
 */
export function parseNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Minúsculas sem acento — os laudos misturam CAIXA ALTA e acentuação. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Unidades de TEMPO que aparecem em qualificadores de faixa etária. */
const IDADE = '(?:anos?|meses|mes|dias?|semanas?|horas?)';

/** "De 21 a 49 ANOS", "de 1 a 29 dias" — a faixa ETÁRIA, não a de valores. */
const FAIXA_ETARIA = new RegExp(
  `\\b(?:de\\s*)?\\d+(?:[.,]\\d+)?\\s*(?:a|ate|-|–)\\s*\\d+(?:[.,]\\d+)?\\s*${IDADE}\\b`,
  'g',
);
/** "maior que 20 anos", "18 anos", "< 1 mês". */
const IDADE_SIMPLES = new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*${IDADE}\\b`, 'g');

/**
 * Remove os qualificadores que cercam a faixa real. Sem isto, "Adultos (Maior
 * que 20 anos): Superior a 40 mg/dL" seria lido como piso 20 — a IDADE virando
 * valor de referência, e a banda do gráfico saindo errada.
 */
function stripQualifiers(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ') // parênteses: quase sempre qualificador
    .replace(FAIXA_ETARIA, ' ')
    .replace(IDADE_SIMPLES, ' ');
}

/** Número com sinal e decimal (vírgula ou ponto). */
const NUM = '(-?\\d+(?:[.,]\\d+)*)';

const BETWEEN = new RegExp(`(?:de|entre)?\\s*${NUM}\\s*(?:a|ate|e|-|–|—|<>)\\s*${NUM}`);
const ONLY_MAX = new RegExp(`(?:inferior(?:\\s+ou\\s+igual)?\\s*a|menor(?:\\s+ou\\s+igual)?\\s+que|abaixo\\s+de|ate|max(?:imo)?\\s*:?|<=?)\\s*${NUM}`);
const ONLY_MIN = new RegExp(`(?:superior(?:\\s+ou\\s+igual)?\\s*a|maior(?:\\s+ou\\s+igual)?\\s+que|acima\\s+de|min(?:imo)?\\s*:?|>=?)\\s*${NUM}`);

/**
 * Extrai min/max do texto de referência do laudo. Reconhece as três formas que
 * aparecem na prática: intervalo ("de X a Y", "X - Y", "entre X e Y"), teto
 * ("inferior a X", "menor que X", "até X") e piso ("superior a X", "acima de
 * X"). Texto irreconhecível ⇒ `{}`.
 *
 * O intervalo é tentado ANTES dos limites simples: "de 0,8 a 1,2" contém "a"
 * mas não é um teto.
 */
export function parseReferenceRange(text: string | undefined | null): ReferenceRange {
  if (!text) return {};
  const s = stripQualifiers(fold(text));

  const between = BETWEEN.exec(s);
  if (between) {
    const min = parseNumber(between[1]!);
    const max = parseNumber(between[2]!);
    // Ordem invertida no laudo não deve virar banda negativa.
    if (min !== null && max !== null && min <= max) return { min, max };
  }

  const out: { min?: number; max?: number } = {};
  const maxOnly = ONLY_MAX.exec(s);
  if (maxOnly) {
    const n = parseNumber(maxOnly[1]!);
    if (n !== null) out.max = n;
  }
  const minOnly = ONLY_MIN.exec(s);
  if (minOnly) {
    const n = parseNumber(minOnly[1]!);
    if (n !== null) out.min = n;
  }
  // Piso acima do teto é leitura incoerente (duas frases distintas no texto) —
  // melhor devolver nada do que desenhar uma banda impossível.
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) return {};
  return out;
}

/**
 * Situação do valor em relação à faixa do laudo — 'dentro' | 'fora' |
 * 'sem-referencia'. Deliberadamente BINÁRIO e sem gradação clínica ("atenção",
 * "alerta"): quem gradua risco é o médico. É só a leitura literal do que o
 * laboratório imprimiu.
 */
export type ReferenceStatus = 'dentro' | 'fora' | 'sem-referencia';

export const REFERENCE_STATUS_LABEL: Record<ReferenceStatus, string> = {
  dentro: 'Dentro da referência do laudo',
  fora: 'Fora da referência do laudo',
  'sem-referencia': 'Sem faixa de referência no laudo',
};

export function classifyAgainstReference(value: number, range: ReferenceRange): ReferenceStatus {
  if (range.min === undefined && range.max === undefined) return 'sem-referencia';
  if (range.min !== undefined && value < range.min) return 'fora';
  if (range.max !== undefined && value > range.max) return 'fora';
  return 'dentro';
}

/** Texto curto da faixa para exibição ("3,5 – 8,5", "< 35", "> 90"). */
export function formatRange(range: ReferenceRange, unit?: string): string | null {
  const u = unit ? ` ${unit}` : '';
  const n = (v: number) => (Number.isInteger(v) ? String(v) : String(v).replace('.', ','));
  if (range.min !== undefined && range.max !== undefined) {
    return `${n(range.min)} – ${n(range.max)}${u}`;
  }
  if (range.max !== undefined) return `< ${n(range.max)}${u}`;
  if (range.min !== undefined) return `> ${n(range.min)}${u}`;
  return null;
}
