import {
  analyteBySlug,
  categoryOf,
  classifyAgainstReference,
  formatRange,
  matchAnalyte,
  toFreeSlug,
  LAB_CATEGORY_ORDER,
  type LabCategory,
  type ReferenceRange,
  type ReferenceStatus,
} from '@nutrimed/lab-catalog';
import type { LabAnalyte, LabExamValues, CustomExamDef, Measurement } from '@nutrimed/patients';
import { compareTrendPoints, type TrendPoint } from './dashboard';

/**
 * Leitura unificada do histórico laboratorial (E14). Existem TRÊS gerações de
 * dado convivendo na mesma tabela, e o médico não deve perceber a diferença:
 *
 * 1. campos fixos do E11 (`ldl`, `hba1c`, `insulina`);
 * 2. slots personalizados do E11 (`custom1..3`, rotulados por {@link CustomExamDef});
 * 3. o painel completo do E14 (`panel: LabAnalyte[]`).
 *
 * Tudo desemboca em séries por SLUG canônico — é o que faz um LDL digitado à
 * mão em 2025 e um LDL importado de PDF em 2026 caírem na MESMA linha do
 * gráfico, em vez de virarem duas séries paralelas.
 */

/** Slugs canônicos correspondentes aos campos fixos do E11. */
const LEGACY_FIELD_SLUG = {
  ldl: 'ldl',
  hba1c: 'hba1c',
  insulina: 'insulina',
} as const;

/** Pseudo-slug de um slot personalizado (não colide com o catálogo). */
export function customSlotSlug(slot: 1 | 2 | 3): string {
  return `custom${slot}`;
}

export interface AnalytePoint extends TrendPoint {
  /** Faixa do laudo vigente NAQUELA medição (pode mudar entre laudos). */
  readonly range?: ReferenceRange;
}

export interface AnalyteSeries {
  readonly slug: string;
  readonly label: string;
  readonly unit?: string;
  readonly category: LabCategory;
  readonly points: readonly AnalytePoint[];
  /** Valor mais recente da série. */
  readonly latest: number;
  /** Data do valor mais recente. */
  readonly latestAt: Date;
  /** Faixa de referência da medição mais recente (base da banda do gráfico). */
  readonly range?: ReferenceRange;
  /** Texto original da referência, como o laboratório escreveu. */
  readonly refText?: string;
  /** Situação do último valor perante a faixa do laudo. */
  readonly status: ReferenceStatus;
}

interface Acumulador {
  slug: string;
  label: string;
  unit?: string;
  points: AnalytePoint[];
}

/** Ordem de categoria (menor primeiro); desconhecida vai para o fim. */
function categoryRank(c: LabCategory): number {
  const i = LAB_CATEGORY_ORDER.indexOf(c);
  return i === -1 ? LAB_CATEGORY_ORDER.length : i;
}

/** Faixa de um analito gravado — só existe se o laudo trouxe algum limite. */
function rangeOf(a: LabAnalyte): ReferenceRange | undefined {
  if (a.refMin === undefined && a.refMax === undefined) return undefined;
  return {
    ...(a.refMin !== undefined ? { min: a.refMin } : {}),
    ...(a.refMax !== undefined ? { max: a.refMax } : {}),
  };
}

/**
 * Constrói as séries de todos os exames que o paciente tem, de qualquer geração.
 * Ordenadas por categoria clínica e, dentro dela, por rótulo.
 *
 * O RÓTULO e a UNIDADE seguem a medição mais recente que os informou: se o
 * laboratório mudar a grafia, a tela passa a mostrar a mais atual sem quebrar a
 * série (que é amarrada pelo slug, não pelo nome).
 */
export function buildAnalyteSeries(
  labs: readonly Measurement<LabExamValues>[],
  customDefs: readonly CustomExamDef[] = [],
): AnalyteSeries[] {
  const porSlug = new Map<string, Acumulador>();

  const push = (
    slug: string,
    label: string,
    unit: string | undefined,
    m: Measurement<LabExamValues>,
    value: number,
    range?: ReferenceRange,
  ) => {
    const atual = porSlug.get(slug);
    const acc = atual ?? { slug, label, unit, points: [] };
    if (!atual) porSlug.set(slug, acc);
    // Medições vêm em ordem cronológica ASC ⇒ a última a escrever é a mais nova.
    acc.label = label;
    if (unit) acc.unit = unit;
    acc.points.push({
      measuredAt: m.measuredAt,
      createdAt: m.createdAt,
      value,
      ...(range ? { range } : {}),
    });
  };

  const defBySlot = new Map(customDefs.map((d) => [d.slot, d]));

  for (const m of labs) {
    // (1) campos fixos do E11
    for (const [campo, slug] of Object.entries(LEGACY_FIELD_SLUG) as [
      keyof typeof LEGACY_FIELD_SLUG,
      string,
    ][]) {
      const v = m.values[campo];
      if (typeof v === 'number') {
        const def = analyteBySlug(slug);
        push(slug, def?.label ?? slug, def?.unit, m, v);
      }
    }

    // (2) slots personalizados do E11 — rótulo vem da configuração atual
    for (const slot of [1, 2, 3] as const) {
      const v = m.values[`custom${slot}` as 'custom1' | 'custom2' | 'custom3'];
      const def = defBySlot.get(slot);
      // Slot sem definição atual não tem nome para exibir — o valor continua no
      // banco e reaparece se o médico renomear o slot (regra do E11).
      if (typeof v === 'number' && def) push(customSlotSlug(slot), def.name, def.unit, m, v);
    }

    // (3) painel completo do E14
    for (const a of m.values.panel ?? []) {
      if (typeof a.value !== 'number' || !Number.isFinite(a.value)) continue;
      push(a.slug, a.label || a.slug, a.unit, m, a.value, rangeOf(a));
    }
  }

  const series: AnalyteSeries[] = [];
  for (const acc of porSlug.values()) {
    if (acc.points.length === 0) continue;
    const ordenados = [...acc.points].sort(compareTrendPoints);
    const ultimo = ordenados[ordenados.length - 1]!;
    const range = ultimo.range;
    series.push({
      slug: acc.slug,
      label: acc.label,
      ...(acc.unit ? { unit: acc.unit } : {}),
      category: categoryOf(acc.slug),
      points: ordenados,
      latest: ultimo.value,
      latestAt: ultimo.measuredAt,
      ...(range ? { range } : {}),
      status: range ? classifyAgainstReference(ultimo.value, range) : 'sem-referencia',
    });
  }

  return series.sort(
    (a, b) =>
      categoryRank(a.category) - categoryRank(b.category) || a.label.localeCompare(b.label, 'pt-BR'),
  );
}

/**
 * Séries escolhidas para a apresentação, NA ORDEM definida pelo médico. Slug
 * selecionado que não tem mais dado é simplesmente ignorado (o exame pode ter
 * sido removido) — a tela nunca mostra um card vazio.
 */
export function selectPresented(
  series: readonly AnalyteSeries[],
  presented: readonly string[],
): AnalyteSeries[] {
  const porSlug = new Map(series.map((s) => [s.slug, s]));
  return presented.map((slug) => porSlug.get(slug)).filter((s): s is AnalyteSeries => s !== undefined);
}

/** Agrupa as séries por categoria, preservando a ordem clínica. */
export function groupByCategory(
  series: readonly AnalyteSeries[],
): { category: LabCategory; series: AnalyteSeries[] }[] {
  const grupos = new Map<LabCategory, AnalyteSeries[]>();
  for (const s of series) {
    const lista = grupos.get(s.category);
    if (lista) lista.push(s);
    else grupos.set(s.category, [s]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b))
    .map(([category, lista]) => ({ category, series: lista }));
}

/** Texto curto da faixa para o card ("3,5 – 8,5 mg/dL"). */
export function rangeLabel(s: AnalyteSeries): string | null {
  return s.range ? formatRange(s.range, s.unit) : null;
}

// ── Histórico impresso no laudo ──────────────────────────────────────────────

/** Chave de um ponto já existente no histórico: `YYYY-MM-DD|slug`. */
export function historyKey(iso: string, slug: string): string {
  return `${iso}|${slug}`;
}

/** Índice dos pontos que o paciente já tem, para não recriá-los. */
export function existingHistoryKeys(
  labs: readonly Measurement<LabExamValues>[],
): Set<string> {
  const chaves = new Set<string>();
  for (const m of labs) {
    const dia = m.measuredAt.toISOString().slice(0, 10);
    for (const a of m.values.panel ?? []) chaves.add(historyKey(dia, a.slug));
  }
  return chaves;
}

export interface PlannedMeasurement {
  /** Data ISO `YYYY-MM-DD` da medição a criar. */
  readonly measuredAt: string;
  readonly analytes: readonly LabAnalyte[];
}

/**
 * Planeja as medições a criar a partir dos resultados ANTERIORES que o laudo
 * imprime ("Evolução do paciente"): agrupa por data, uma medição por data, como
 * se tivessem sido lançados na época. É isso que faz a primeira importação já
 * nascer com linha de tendência em vez de um ponto solitário.
 *
 * Idempotente por construção — o que já existe é pulado, então reimportar o
 * mesmo PDF não cria pontos repetidos no gráfico. O ponto na própria data da
 * coleta também é descartado (seria duplicata do valor atual).
 *
 * A faixa de referência NÃO é replicada nos pontos antigos: o laudo imprime a
 * referência vigente HOJE, que não necessariamente valia na data antiga.
 */
export function planHistoryImport(input: {
  readonly analytes: readonly {
    readonly slug: string;
    readonly label: string;
    readonly unit?: string;
    readonly history?: readonly { readonly measuredAt: string; readonly value: number }[];
  }[];
  readonly existing: ReadonlySet<string>;
  readonly collectionDate: string;
}): PlannedMeasurement[] {
  const porData = new Map<string, LabAnalyte[]>();
  const vistos = new Set<string>();

  for (const a of input.analytes) {
    for (const p of a.history ?? []) {
      const chave = historyKey(p.measuredAt, a.slug);
      if (
        p.measuredAt === input.collectionDate ||
        input.existing.has(chave) ||
        vistos.has(chave) // o mesmo exame repetido no laudo não duplica o ponto
      ) {
        continue;
      }
      vistos.add(chave);
      const lista = porData.get(p.measuredAt) ?? [];
      lista.push({
        slug: a.slug,
        label: a.label,
        value: p.value,
        ...(a.unit ? { unit: a.unit } : {}),
      });
      porData.set(p.measuredAt, lista);
    }
  }

  // Mais antigo primeiro: a ordem de inserção acompanha a cronologia.
  return [...porData.keys()]
    .sort()
    .map((measuredAt) => ({ measuredAt, analytes: porData.get(measuredAt)! }));
}

// ── Canonicalização na importação ────────────────────────────────────────────

/**
 * Converte um analito extraído do PDF no formato PERSISTIDO, resolvendo o slug
 * pelo catálogo. Sem match, vira analito livre — nada é descartado (o laudo é
 * do paciente; um exame raro não pode sumir só por não estar na nossa lista).
 */
export function toStoredAnalyte(input: {
  rawName: string;
  value: number;
  unit?: string;
  range?: ReferenceRange;
  refText?: string;
}): LabAnalyte {
  const def = matchAnalyte(input.rawName);
  const slug = def?.slug ?? toFreeSlug(input.rawName);
  return {
    slug,
    label: def?.label ?? input.rawName,
    value: input.value,
    ...(input.unit ?? def?.unit ? { unit: input.unit ?? def?.unit } : {}),
    ...(input.range?.min !== undefined ? { refMin: input.range.min } : {}),
    ...(input.range?.max !== undefined ? { refMax: input.range.max } : {}),
    ...(input.refText ? { refText: input.refText } : {}),
    rawName: input.rawName,
  };
}

/**
 * Resolve COLISÕES de slug dentro de um mesmo laudo.
 *
 * Um laudo real imprime linhas distintas que o catálogo pode reduzir ao mesmo
 * exame — o TTPA traz plasma do paciente (38,5 s), plasma controle (28,8 s) e a
 * relação entre eles (1,34); o RFG traz a estimativa para adulto negro e não
 * negro. Se as três virassem o slug `ttpa`, a série teria três pontos na MESMA
 * data com grandezas incomparáveis, e o "valor atual" do card seria sorteado
 * pela ordem de inserção.
 *
 * Regra: dentro de um laudo, um slug canônico aparece UMA vez. A primeira
 * ocorrência fica com ele; as seguintes são rebaixadas a analito livre, com o
 * nome que o laboratório imprimiu. Nada é descartado e nada se mistura — o
 * médico vê as três linhas, rotuladas como no laudo.
 *
 * É um guard estrutural, não um remendo de catálogo: vale para qualquer exame
 * que um laboratório futuro decomponha de um jeito que não anteciparíamos.
 */
export function resolveSlugCollisions(analytes: readonly LabAnalyte[]): LabAnalyte[] {
  const usados = new Set<string>();
  const out: LabAnalyte[] = [];

  for (const a of analytes) {
    if (!usados.has(a.slug)) {
      usados.add(a.slug);
      out.push(a);
      continue;
    }
    const nome = a.rawName ?? a.label;
    let slug = toFreeSlug(nome);
    // Dois rawNames idênticos no mesmo laudo geram o mesmo slug livre; sufixa
    // até achar um livre, para nunca perder uma linha.
    let n = 2;
    while (usados.has(slug)) {
      slug = `${toFreeSlug(nome)}-${n}`;
      n += 1;
    }
    usados.add(slug);
    out.push({ ...a, slug, label: nome });
  }

  return out;
}
