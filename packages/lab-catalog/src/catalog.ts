/**
 * Catálogo curado de exames laboratoriais (E14). Existe por UM motivo: manter a
 * SÉRIE HISTÓRICA íntegra. O mesmo exame muda de nome entre laboratórios (e no
 * mesmo laboratório entre anos) — "TGP", "ALT", "Transaminase Pirúvica" são o
 * mesmo analito. Sem canonicalização, cada grafia viraria uma linha separada no
 * gráfico e a evolução do paciente se fragmentaria.
 *
 * O catálogo NÃO é um gate: exame fora dele entra como analito LIVRE
 * (ver `toFreeSlug`), com o nome que veio no laudo. Nada é descartado.
 *
 * O catálogo também NÃO carrega faixas de referência clínicas: elas vêm do
 * próprio laudo, por medição (ver `parseReferenceRange`). Manter faixas aqui
 * seria assumir responsabilidade clínica que é do laboratório e do médico
 * ("IA assiste, médico decide") — e desatualiza: este mesmo laudo avisa de
 * mudanças de referência em 2024 e 2025.
 */

/** Agrupamento de apresentação — só organiza a tela, sem juízo clínico. */
export type LabCategory =
  | 'hemograma'
  | 'metabolico'
  | 'lipidico'
  | 'renal'
  | 'hepatico'
  | 'hormonal'
  | 'vitaminas'
  | 'minerais'
  | 'inflamacao'
  | 'coagulacao'
  | 'outros';

export const LAB_CATEGORY_LABEL: Record<LabCategory, string> = {
  hemograma: 'Hemograma',
  metabolico: 'Metabólico',
  lipidico: 'Lipídico',
  renal: 'Renal',
  hepatico: 'Hepático',
  hormonal: 'Hormonal',
  vitaminas: 'Vitaminas',
  minerais: 'Minerais',
  inflamacao: 'Inflamação',
  coagulacao: 'Coagulação',
  outros: 'Outros',
};

/** Ordem de exibição das categorias na dashboard (clínica, não alfabética). */
export const LAB_CATEGORY_ORDER: readonly LabCategory[] = [
  'metabolico',
  'lipidico',
  'hormonal',
  'hemograma',
  'inflamacao',
  'hepatico',
  'renal',
  'vitaminas',
  'minerais',
  'coagulacao',
  'outros',
];

export interface LabAnalyteDef {
  /** Chave canônica e estável — é ela que amarra a série histórica. */
  readonly slug: string;
  /** Rótulo de exibição (o nome que o médico lê na tela). */
  readonly label: string;
  /** Unidade usual. O valor real usa a unidade do laudo quando ela vier. */
  readonly unit?: string;
  readonly category: LabCategory;
  /**
   * Grafias que devem casar com este slug. O `label` e o `slug` já casam
   * implicitamente — liste aqui apenas o que é DIFERENTE deles.
   */
  readonly aliases?: readonly string[];
}

/**
 * Catálogo. Cobre o painel completo do laudo de referência (Grupo Santa Helena,
 * 41 analitos) mais os pedidos com frequência em nutrologia. Crescer daqui é
 * acrescentar linhas — nada mais depende do tamanho desta lista.
 */
export const LAB_CATALOG: readonly LabAnalyteDef[] = [
  // ── Metabólico ────────────────────────────────────────────────────────────
  { slug: 'glicose', label: 'Glicose', unit: 'mg/dL', category: 'metabolico', aliases: ['glicemia', 'glicemia de jejum', 'glicose de jejum'] },
  { slug: 'hba1c', label: 'Hemoglobina Glicada', unit: '%', category: 'metabolico', aliases: ['hemoglobina glicada', 'hemoglobina glicosilada', 'a1c', 'hb a1c', 'hba1c'] },
  { slug: 'insulina', label: 'Insulina', unit: 'µU/mL', category: 'metabolico', aliases: ['insulina de jejum', 'insulina basal'] },
  { slug: 'acido-urico', label: 'Ácido Úrico', unit: 'mg/dL', category: 'metabolico', aliases: ['urato'] },
  { slug: 'glicemia-media-estimada', label: 'Glicemia Média Estimada', unit: 'mg/dL', category: 'metabolico', aliases: ['gme', 'glicemia media'] },

  // ── Lipídico ──────────────────────────────────────────────────────────────
  { slug: 'colesterol-total', label: 'Colesterol Total', unit: 'mg/dL', category: 'lipidico', aliases: ['colesterol'] },
  { slug: 'hdl', label: 'HDL', unit: 'mg/dL', category: 'lipidico', aliases: ['colesterol hdl', 'hdl colesterol', 'hdl-c'] },
  { slug: 'ldl', label: 'LDL', unit: 'mg/dL', category: 'lipidico', aliases: ['colesterol ldl', 'ldl colesterol', 'ldl-c'] },
  { slug: 'vldl', label: 'VLDL', unit: 'mg/dL', category: 'lipidico', aliases: ['colesterol vldl'] },
  { slug: 'nao-hdl', label: 'Colesterol não-HDL', unit: 'mg/dL', category: 'lipidico', aliases: ['nao hdl', 'colesterol nao hdl'] },
  { slug: 'triglicerides', label: 'Triglicérides', unit: 'mg/dL', category: 'lipidico', aliases: ['triglicerideos', 'triglicerides', 'trigliceridios'] },

  // ── Hormonal ──────────────────────────────────────────────────────────────
  { slug: 'tsh', label: 'TSH', unit: 'mUI/mL', category: 'hormonal', aliases: ['tsh ultra sensivel', 'tsh ultrassensivel', 'hormonio tireoestimulante'] },
  { slug: 't4-livre', label: 'T4 Livre', unit: 'ng/dL', category: 'hormonal', aliases: ['tiroxina livre', 't4l', 'tiroxina livre t4l'] },
  { slug: 't3-livre', label: 'T3 Livre', unit: 'pg/mL', category: 'hormonal', aliases: ['triiodotironina livre', 't3l'] },
  { slug: 't3-total', label: 'T3 Total', unit: 'ng/dL', category: 'hormonal', aliases: ['triiodotironina', 'triiodotironina total'] },
  { slug: 'anti-tpo', label: 'Anti-TPO', unit: 'UI/mL', category: 'hormonal', aliases: ['tireoperoxidase anticorpos anti', 'anticorpos anti tireoperoxidase', 'anti tpo', 'tpo'] },
  { slug: 'anti-tireoglobulina', label: 'Anti-Tireoglobulina', unit: 'UI/mL', category: 'hormonal', aliases: ['tireoglobulina anticorpos anti', 'anticorpos anti tireoglobulina', 'anti tg'] },
  { slug: 'testosterona-total', label: 'Testosterona Total', unit: 'ng/dL', category: 'hormonal', aliases: ['testosterona'] },
  { slug: 'testosterona-livre', label: 'Testosterona Livre', unit: 'ng/dL', category: 'hormonal', aliases: ['testosterona livre calculada'] },
  { slug: 'shbg', label: 'SHBG', unit: 'nmol/L', category: 'hormonal', aliases: ['globulina ligadora de hormonios sexuais', 'globulina ligadora de hormonio sexual'] },
  { slug: 'estradiol', label: 'Estradiol', unit: 'pg/mL', category: 'hormonal', aliases: ['e2', 'estradiol e2', 'estradiol 17 beta', 'estradiol e2 17 beta'] },
  { slug: 'lh', label: 'LH', unit: 'mUI/mL', category: 'hormonal', aliases: ['hormonio luteinizante'] },
  { slug: 'fsh', label: 'FSH', unit: 'mUI/mL', category: 'hormonal', aliases: ['hormonio foliculo estimulante'] },
  { slug: 'prolactina', label: 'Prolactina', unit: 'ng/mL', category: 'hormonal', aliases: ['prl'] },
  { slug: 'cortisol', label: 'Cortisol', unit: 'mcg/dL', category: 'hormonal', aliases: ['cortisol matinal', 'cortisol serico'] },
  { slug: 'dhea-s', label: 'DHEA-S', unit: 'mcg/dL', category: 'hormonal', aliases: ['sulfato de dehidroepiandrosterona', 'dheas', 'dhea sulfato'] },
  { slug: 'igf-1', label: 'IGF-1', unit: 'ng/mL', category: 'hormonal', aliases: ['somatomedina c', 'igf 1'] },
  { slug: 'pth', label: 'PTH', unit: 'pg/mL', category: 'hormonal', aliases: ['paratormonio', 'hormonio da paratireoide'] },

  // ── Hemograma ─────────────────────────────────────────────────────────────
  { slug: 'hemoglobina', label: 'Hemoglobina', unit: 'g/dL', category: 'hemograma', aliases: ['hb'] },
  { slug: 'hematocrito', label: 'Hematócrito', unit: '%', category: 'hemograma', aliases: ['ht', 'hct'] },
  { slug: 'hemacias', label: 'Hemácias', unit: 'milhões/mm³', category: 'hemograma', aliases: ['eritrocitos', 'contagem de hemacias'] },
  { slug: 'vcm', label: 'VCM', unit: 'fL', category: 'hemograma', aliases: ['volume corpuscular medio'] },
  { slug: 'hcm', label: 'HCM', unit: 'pg', category: 'hemograma', aliases: ['hemoglobina corpuscular media'] },
  { slug: 'chcm', label: 'CHCM', unit: 'g/dL', category: 'hemograma', aliases: ['concentracao de hemoglobina corpuscular media'] },
  { slug: 'rdw', label: 'RDW', unit: '%', category: 'hemograma', aliases: ['rdw cv'] },
  { slug: 'leucocitos', label: 'Leucócitos', unit: '/mm³', category: 'hemograma', aliases: ['leucograma', 'globulos brancos'] },
  { slug: 'plaquetas', label: 'Plaquetas', unit: 'mil/mm³', category: 'hemograma' },
  { slug: 'mpv', label: 'MPV', unit: 'fL', category: 'hemograma', aliases: ['volume plaquetario medio'] },
  { slug: 'segmentados', label: 'Segmentados', unit: '/mm³', category: 'hemograma', aliases: ['neutrofilos', 'neutrofilos segmentados'] },
  { slug: 'linfocitos', label: 'Linfócitos', unit: '/mm³', category: 'hemograma' },
  { slug: 'monocitos', label: 'Monócitos', unit: '/mm³', category: 'hemograma' },
  { slug: 'eosinofilos', label: 'Eosinófilos', unit: '/mm³', category: 'hemograma' },
  { slug: 'basofilos', label: 'Basófilos', unit: '/mm³', category: 'hemograma' },

  // ── Inflamação ────────────────────────────────────────────────────────────
  { slug: 'pcr', label: 'PCR Ultrassensível', unit: 'mg/L', category: 'inflamacao', aliases: ['proteina c reativa', 'pcr us', 'proteina c reativa quantitativa alta sensibilidade', 'proteina c reativa ultrassensivel'] },
  { slug: 'vhs', label: 'VHS', unit: 'mm/h', category: 'inflamacao', aliases: ['velocidade de hemossedimentacao'] },
  { slug: 'homocisteina', label: 'Homocisteína', unit: 'µmol/L', category: 'inflamacao' },

  // ── Hepático ──────────────────────────────────────────────────────────────
  { slug: 'tgo', label: 'TGO / AST', unit: 'U/L', category: 'hepatico', aliases: ['ast', 'tgo ast', 'transaminase oxalacetica', 'aspartato aminotransferase'] },
  { slug: 'tgp', label: 'TGP / ALT', unit: 'U/L', category: 'hepatico', aliases: ['alt', 'tgp alt', 'transaminase piruvica', 'alanina aminotransferase'] },
  { slug: 'gama-gt', label: 'Gama GT', unit: 'U/L', category: 'hepatico', aliases: ['ggt', 'gamma gt', 'gama glutamil transferase'] },
  { slug: 'fosfatase-alcalina', label: 'Fosfatase Alcalina', unit: 'U/L', category: 'hepatico', aliases: ['fa'] },
  { slug: 'bilirrubina-total', label: 'Bilirrubina Total', unit: 'mg/dL', category: 'hepatico', aliases: ['bilirrubina total e fracoes', 'bt'] },
  { slug: 'bilirrubina-direta', label: 'Bilirrubina Direta', unit: 'mg/dL', category: 'hepatico', aliases: ['bd'] },
  { slug: 'bilirrubina-indireta', label: 'Bilirrubina Indireta', unit: 'mg/dL', category: 'hepatico', aliases: ['bi'] },
  { slug: 'proteinas-totais', label: 'Proteínas Totais', unit: 'g/dL', category: 'hepatico', aliases: ['proteinas totais e fracoes'] },
  { slug: 'albumina', label: 'Albumina', unit: 'g/dL', category: 'hepatico' },
  { slug: 'globulina', label: 'Globulina', unit: 'g/dL', category: 'hepatico', aliases: ['globulinas'] },

  // ── Renal ─────────────────────────────────────────────────────────────────
  { slug: 'creatinina', label: 'Creatinina', unit: 'mg/dL', category: 'renal' },
  { slug: 'ureia', label: 'Ureia', unit: 'mg/dL', category: 'renal', aliases: ['uréia'] },
  { slug: 'tfg', label: 'Taxa de Filtração Glomerular', unit: 'mL/min/1,73m²', category: 'renal', aliases: ['rfg', 'ritmo de filtracao glomerular', 'clearance de creatinina', 'ckd epi'] },

  // ── Vitaminas ─────────────────────────────────────────────────────────────
  { slug: 'vitamina-d', label: 'Vitamina D', unit: 'ng/mL', category: 'vitaminas', aliases: ['25 hidroxivitamina d', '25 oh vitamina d', 'vitamina d 25 hidroxi', 'calcidiol'] },
  { slug: 'vitamina-b12', label: 'Vitamina B12', unit: 'pg/mL', category: 'vitaminas', aliases: ['b12', 'cianocobalamina', 'cobalamina'] },
  { slug: 'acido-folico', label: 'Ácido Fólico', unit: 'ng/mL', category: 'vitaminas', aliases: ['folato', 'vitamina b9'] },
  { slug: 'vitamina-a', label: 'Vitamina A', unit: 'mcg/dL', category: 'vitaminas', aliases: ['retinol'] },
  { slug: 'vitamina-e', label: 'Vitamina E', unit: 'mg/L', category: 'vitaminas', aliases: ['alfa tocoferol', 'tocoferol'] },

  // ── Minerais / ferro ──────────────────────────────────────────────────────
  { slug: 'ferro', label: 'Ferro Sérico', unit: 'µg/dL', category: 'minerais', aliases: ['ferro serico', 'ferro'] },
  { slug: 'ferritina', label: 'Ferritina', unit: 'ng/mL', category: 'minerais' },
  { slug: 'transferrina', label: 'Transferrina', unit: 'mg/dL', category: 'minerais' },
  { slug: 'saturacao-transferrina', label: 'Saturação da Transferrina', unit: '%', category: 'minerais', aliases: ['indice de saturacao da transferrina', 'ist'] },
  { slug: 'zinco', label: 'Zinco', unit: 'mcg/dL', category: 'minerais' },
  { slug: 'magnesio', label: 'Magnésio', unit: 'mg/dL', category: 'minerais' },
  { slug: 'calcio', label: 'Cálcio', unit: 'mg/dL', category: 'minerais', aliases: ['calcio serico', 'calcio total'] },
  { slug: 'potassio', label: 'Potássio', unit: 'mmol/L', category: 'minerais', aliases: ['k'] },
  { slug: 'sodio', label: 'Sódio', unit: 'mmol/L', category: 'minerais', aliases: ['na'] },
  { slug: 'fosforo', label: 'Fósforo', unit: 'mg/dL', category: 'minerais', aliases: ['fosforo serico', 'fosfato'] },
  { slug: 'selenio', label: 'Selênio', unit: 'mcg/L', category: 'minerais' },

  // ── Coagulação ────────────────────────────────────────────────────────────
  { slug: 'inr', label: 'INR', category: 'coagulacao', aliases: ['rni', 'r n i', 'razao normalizada internacional'] },
  // TEMPO (segundos) e ATIVIDADE (%) são grandezas distintas impressas sob o
  // mesmo título "Tempo Atividade Protrombina (TP)". Confundi-las inverteria o
  // valor e a faixa (12,1 seg contra uma referência de "> 70%").
  { slug: 'tempo-protrombina', label: 'Tempo de Protrombina', unit: 'seg', category: 'coagulacao', aliases: ['tempo atividade protrombina', 'tempo de protrombina', 'tempo de atividade de protrombina'] },
  { slug: 'tap', label: 'Atividade de Protrombina', unit: '%', category: 'coagulacao', aliases: ['atividade de protrombina', 'atividade tp', 'tp'] },
  // O TTPA imprime TRÊS números (plasma do paciente, plasma controle e a
  // relação entre eles). São séries diferentes — sem entradas próprias, os três
  // colidiriam num slug só e virariam pontos incomparáveis na mesma linha.
  { slug: 'ttpa', label: 'TTPA (relação)', category: 'coagulacao', aliases: ['tempo de tromboplastina parcial ativado', 'ttpa relacao', 'relacao paciente normal', 'relacao paciente', 'relacao paciente normal do dia'] },
  { slug: 'ttpa-paciente', label: 'TTPA — Plasma Paciente', unit: 'seg', category: 'coagulacao', aliases: ['plasma paciente'] },
  { slug: 'ttpa-normal', label: 'TTPA — Plasma Normal', unit: 'seg', category: 'coagulacao', aliases: ['plasma normal do dia', 'plasma normal'] },
  { slug: 'tempo-sangramento', label: 'Tempo de Sangramento', unit: 'min', category: 'coagulacao', aliases: ['ts'] },
];

/** Prefixo dos analitos que não estão no catálogo (ver `toFreeSlug`). */
export const FREE_SLUG_PREFIX = 'livre:';

/**
 * Normaliza um nome de exame para comparação: minúsculas, sem acento, sem
 * pontuação, espaços colapsados. "TGP/ALT — Transaminase Pirúvica" ⇒
 * "tgp alt transaminase piruvica".
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Índice nome-normalizado → def, montado uma vez. */
const INDEX = new Map<string, LabAnalyteDef>();
for (const def of LAB_CATALOG) {
  for (const name of [def.slug, def.label, ...(def.aliases ?? [])]) {
    const k = normalizeName(name);
    // Primeiro a registrar vence: a ordem do catálogo é a autoridade, um alias
    // repetido por engano nunca sequestra o slug de outro exame.
    if (!INDEX.has(k)) INDEX.set(k, def);
  }
}

/** Busca exata por nome normalizado (slug, label ou alias). */
export function findAnalyte(rawName: string): LabAnalyteDef | undefined {
  return INDEX.get(normalizeName(rawName));
}

/** Def pelo slug canônico (nulo para analitos livres). */
export function analyteBySlug(slug: string): LabAnalyteDef | undefined {
  return LAB_CATALOG.find((d) => d.slug === slug);
}

/**
 * Casa um nome de laudo com o catálogo. Tenta o nome inteiro e, se falhar, os
 * pedaços separados por `/`, `-` ou `–` — laudos escrevem "TGO/AST -
 * TRANSAMINASE OXALACÉTICA", em que só um pedaço casa. Sem match ⇒ undefined
 * (o chamador cria um analito livre; nada é descartado).
 */
export function matchAnalyte(rawName: string): LabAnalyteDef | undefined {
  const direct = findAnalyte(rawName);
  if (direct) return direct;
  for (const part of rawName.split(/[/\-–—,(]/)) {
    const t = part.trim();
    if (t.length < 2) continue;
    const hit = findAnalyte(t);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Slug de um exame fora do catálogo. Prefixado para nunca colidir com um slug
 * canônico — se o exame entrar no catálogo depois, o slug muda e a série antiga
 * fica visível como exame livre (não some), pronta para ser unificada à mão.
 */
export function toFreeSlug(rawName: string): string {
  const base = normalizeName(rawName).replace(/ /g, '-').slice(0, 48);
  return `${FREE_SLUG_PREFIX}${base || 'exame'}`;
}

/** Verdadeiro para slugs de exames livres (fora do catálogo). */
export function isFreeSlug(slug: string): boolean {
  return slug.startsWith(FREE_SLUG_PREFIX);
}

/** Categoria de um slug — analito livre cai em 'outros'. */
export function categoryOf(slug: string): LabCategory {
  return analyteBySlug(slug)?.category ?? 'outros';
}
