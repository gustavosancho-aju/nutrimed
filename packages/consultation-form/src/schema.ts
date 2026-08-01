/**
 * Ficha de Consulta — Nutrologia (modelo do Dr. Rafael Bastos).
 *
 * Este arquivo é a ÚNICA definição da ficha: os mesmos grupos de opções
 * alimentam o prompt da IA, a validação do JSON que ela devolve e o formulário
 * na tela. Duas listas separadas (uma no prompt, outra no form) sairiam de
 * sincronia no primeiro campo novo, e o sintoma seria a IA marcando uma opção
 * que a tela não sabe desenhar — some da ficha sem ninguém perceber.
 *
 * A ficha é dado de saúde: cifrada em repouso (NFR9) e auditada a cada
 * geração/edição (NFR10) — ver `store.ts`.
 */

/** Uma opção de checkbox: `value` é o que persiste, `label` o que se lê. */
export interface FormOption {
  readonly value: string;
  readonly label: string;
}

const opts = (...pairs: readonly (readonly [string, string])[]): readonly FormOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const OBJETIVO_PRINCIPAL = opts(
  ['emagrecimento', 'Emagrecimento'],
  ['performance', 'Performance'],
  ['longevidade', 'Longevidade'],
  ['hipertrofia', 'Hipertrofia'],
  ['saude-metabolica', 'Saúde metabólica'],
  ['prevencao-cardiovascular', 'Prevenção cardiovascular'],
  ['controle-glicemico', 'Controle glicêmico'],
  ['energia-disposicao', 'Energia/disposição'],
);

export const DOENCAS_ASSOCIADAS = opts(
  ['hipertensao', 'Hipertensão'],
  ['diabetes', 'Diabetes'],
  ['pre-diabetes', 'Pré-diabetes'],
  ['dislipidemia', 'Dislipidemia'],
  ['esteatose-hepatica', 'Esteatose hepática'],
  ['apneia-do-sono', 'Apneia do sono'],
  ['sop', 'SOP'],
  ['hipogonadismo', 'Hipogonadismo'],
  ['dcv', 'DCV'],
  ['neoplasia', 'Neoplasia'],
);

export const HISTORICO_FAMILIAR = opts(
  ['infarto-precoce', 'Infarto precoce'],
  ['avc', 'AVC'],
  ['diabetes', 'Diabetes'],
  ['obesidade', 'Obesidade'],
  ['morte-subita', 'Morte súbita'],
  ['hipertensao', 'Hipertensão'],
  ['neoplasia', 'Neoplasia'],
);

export const ALIMENTACAO = opts(
  ['compulsao-alimentar', 'Compulsão alimentar'],
  ['beliscos-frequentes', 'Beliscos frequentes'],
  ['come-emocional', 'Come emocional'],
  ['ultraprocessados-frequentes', 'Ultraprocessados frequentes'],
  ['refrigerante', 'Refrigerante'],
  ['alcool-frequente', 'Álcool frequente'],
);

export const SONO = opts(
  ['ronco', 'Ronco'],
  ['sono-ruim', 'Sono ruim'],
  ['sonolencia-diurna', 'Sonolência diurna'],
  ['acorda-cansado', 'Acorda cansado'],
);

export const EXAME_FISICO = opts(
  ['acantose-nigricans', 'Acantose nigricans'],
  ['sarcopenia', 'Sarcopenia'],
  ['edema', 'Edema'],
  ['obesidade-central', 'Obesidade central'],
  ['ginecomastia', 'Ginecomastia'],
);

export const OBJETIVOS_TERAPEUTICOS = opts(
  ['reduzir-gordura-visceral', 'Reduzir gordura visceral'],
  ['ganhar-massa-muscular', 'Ganhar massa muscular'],
  ['melhorar-resistencia-insulinica', 'Melhorar resistência insulínica'],
  ['melhorar-performance', 'Melhorar performance'],
  ['melhorar-exames', 'Melhorar exames'],
  ['longevidade-saudavel', 'Longevidade saudável'],
);

export const RISCO_CARDIOMETABOLICO = opts(
  ['baixo', 'Baixo'],
  ['moderado', 'Moderado'],
  ['alto', 'Alto'],
);

// ── Estrutura da ficha ─────────────────────────────────────────────────────

export interface ConsultationForm {
  readonly identificacao: {
    readonly nome: string | null;
    readonly idade: string | null;
    readonly sexo: string | null;
    readonly profissao: string | null;
    readonly telefone: string | null;
    readonly data: string | null;
  };
  readonly objetivoPrincipal: {
    readonly marcados: readonly string[];
    readonly outro: string | null;
    readonly motivo: string | null;
  };
  readonly antropometria: {
    readonly pesoAtual: string | null;
    readonly pesoMaximo: string | null;
    readonly pesoMinimoAdulto: string | null;
    readonly altura: string | null;
    readonly imc: string | null;
  };
  readonly doencasAssociadas: { readonly marcados: readonly string[]; readonly observacoes: string | null };
  readonly historicoFamiliar: { readonly marcados: readonly string[]; readonly observacoes: string | null };
  readonly alimentacao: { readonly marcados: readonly string[]; readonly observacoes: string | null };
  readonly exercicio: {
    readonly sedentario: boolean;
    readonly atividade: string | null;
    readonly frequenciaSemanal: string | null;
    readonly duracao: string | null;
    readonly intensidade: string | null;
  };
  readonly sono: { readonly horasPorNoite: string | null; readonly marcados: readonly string[] };
  readonly medicacoes: {
    readonly usoContinuo: string | null;
    readonly suplementos: string | null;
    readonly hormoniosPrevios: string | null;
    readonly alergias: string | null;
  };
  readonly exameFisico: {
    readonly pa: string | null;
    readonly fc: string | null;
    readonly marcados: readonly string[];
    readonly observacoes: string | null;
  };
  readonly estratificacao: {
    readonly prevent: string | null;
    readonly riscoCardiometabolico: string | null;
  };
  readonly objetivosTerapeuticos: { readonly marcados: readonly string[]; readonly metas: string | null };
  readonly conduta: {
    readonly nutricao: string | null;
    readonly exercicio: string | null;
    readonly medicacoes: string | null;
    readonly suplementacao: string | null;
    readonly solicitacaoExames: string | null;
    readonly metas: string | null;
  };
  readonly retorno: { readonly data: string | null; readonly observacoes: string | null };
}

/** Ficha totalmente em branco — base do sanitize e do formulário sem dados. */
export const EMPTY_FORM: ConsultationForm = {
  identificacao: { nome: null, idade: null, sexo: null, profissao: null, telefone: null, data: null },
  objetivoPrincipal: { marcados: [], outro: null, motivo: null },
  antropometria: { pesoAtual: null, pesoMaximo: null, pesoMinimoAdulto: null, altura: null, imc: null },
  doencasAssociadas: { marcados: [], observacoes: null },
  historicoFamiliar: { marcados: [], observacoes: null },
  alimentacao: { marcados: [], observacoes: null },
  exercicio: { sedentario: false, atividade: null, frequenciaSemanal: null, duracao: null, intensidade: null },
  sono: { horasPorNoite: null, marcados: [] },
  medicacoes: { usoContinuo: null, suplementos: null, hormoniosPrevios: null, alergias: null },
  exameFisico: { pa: null, fc: null, marcados: [], observacoes: null },
  estratificacao: { prevent: null, riscoCardiometabolico: null },
  objetivosTerapeuticos: { marcados: [], metas: null },
  conduta: {
    nutricao: null,
    exercicio: null,
    medicacoes: null,
    suplementacao: null,
    solicitacaoExames: null,
    metas: null,
  },
  retorno: { data: null, observacoes: null },
};

// ── Normalização ───────────────────────────────────────────────────────────

/** Texto vindo de LLM ou de `<input>`: vazio/whitespace ⇒ null (campo em branco). */
function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Só sobrevivem valores que existem no grupo. A IA às vezes devolve o RÓTULO
 * ("Apneia do sono") em vez do value, ou inventa uma opção próxima — aceitar o
 * rótulo é barato, e o que não casa é DESCARTADO em vez de virar um checkbox
 * fantasma que a tela não desenha. O que ela quis dizer e não coube ainda chega
 * ao médico pelas observações do bloco.
 */
function marks(value: unknown, group: readonly FormOption[]): readonly string[] {
  if (!Array.isArray(value)) return [];
  const byValue = new Map(group.map((o) => [o.value, o.value]));
  const byLabel = new Map(group.map((o) => [o.label.toLowerCase(), o.value]));
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim();
    const hit = byValue.get(key) ?? byLabel.get(key.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function one(value: unknown, group: readonly FormOption[]): string | null {
  return marks([value], group)[0] ?? null;
}

/**
 * Converte QUALQUER objeto (JSON da IA, FormData da tela, blob antigo do banco)
 * numa ficha completa e válida. Campo ausente vira branco, opção desconhecida
 * é descartada — nunca lança: uma ficha meio preenchida é útil ao médico, um
 * erro de parse no fim da consulta não é.
 */
export function sanitizeForm(raw: unknown): ConsultationForm {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const g = (key: string): Record<string, unknown> => r[key] ?? {};
  const ident = g('identificacao');
  const obj = g('objetivoPrincipal');
  const ant = g('antropometria');
  const doe = g('doencasAssociadas');
  const hist = g('historicoFamiliar');
  const ali = g('alimentacao');
  const exe = g('exercicio');
  const son = g('sono');
  const med = g('medicacoes');
  const fis = g('exameFisico');
  const est = g('estratificacao');
  const ter = g('objetivosTerapeuticos');
  const con = g('conduta');
  const ret = g('retorno');
  return {
    identificacao: {
      nome: str(ident.nome),
      idade: str(ident.idade),
      sexo: str(ident.sexo),
      profissao: str(ident.profissao),
      telefone: str(ident.telefone),
      data: str(ident.data),
    },
    objetivoPrincipal: {
      marcados: marks(obj.marcados, OBJETIVO_PRINCIPAL),
      outro: str(obj.outro),
      motivo: str(obj.motivo),
    },
    antropometria: {
      pesoAtual: str(ant.pesoAtual),
      pesoMaximo: str(ant.pesoMaximo),
      pesoMinimoAdulto: str(ant.pesoMinimoAdulto),
      altura: str(ant.altura),
      imc: str(ant.imc),
    },
    doencasAssociadas: {
      marcados: marks(doe.marcados, DOENCAS_ASSOCIADAS),
      observacoes: str(doe.observacoes),
    },
    historicoFamiliar: {
      marcados: marks(hist.marcados, HISTORICO_FAMILIAR),
      observacoes: str(hist.observacoes),
    },
    alimentacao: { marcados: marks(ali.marcados, ALIMENTACAO), observacoes: str(ali.observacoes) },
    exercicio: {
      sedentario: exe.sedentario === true || exe.sedentario === 'true' || exe.sedentario === 'on',
      atividade: str(exe.atividade),
      frequenciaSemanal: str(exe.frequenciaSemanal),
      duracao: str(exe.duracao),
      intensidade: str(exe.intensidade),
    },
    sono: { horasPorNoite: str(son.horasPorNoite), marcados: marks(son.marcados, SONO) },
    medicacoes: {
      usoContinuo: str(med.usoContinuo),
      suplementos: str(med.suplementos),
      hormoniosPrevios: str(med.hormoniosPrevios),
      alergias: str(med.alergias),
    },
    exameFisico: {
      pa: str(fis.pa),
      fc: str(fis.fc),
      marcados: marks(fis.marcados, EXAME_FISICO),
      observacoes: str(fis.observacoes),
    },
    estratificacao: {
      prevent: str(est.prevent),
      riscoCardiometabolico: one(est.riscoCardiometabolico, RISCO_CARDIOMETABOLICO),
    },
    objetivosTerapeuticos: {
      marcados: marks(ter.marcados, OBJETIVOS_TERAPEUTICOS),
      metas: str(ter.metas),
    },
    conduta: {
      nutricao: str(con.nutricao),
      exercicio: str(con.exercicio),
      medicacoes: str(con.medicacoes),
      suplementacao: str(con.suplementacao),
      solicitacaoExames: str(con.solicitacaoExames),
      metas: str(con.metas),
    },
    retorno: { data: str(ret.data), observacoes: str(ret.observacoes) },
  };
}

// ── Campos que o sistema conhece ───────────────────────────────────────────

/** Dados que o NutriMed já tem estruturados e NÃO precisam passar por IA. */
export interface KnownFields {
  readonly nome?: string | null;
  readonly idade?: number | null;
  readonly profissao?: string | null;
  readonly telefone?: string | null;
  readonly data?: string | null;
  readonly alturaCm?: number | null;
  readonly pesoKg?: number | null;
  readonly imc?: number | null;
}

const num = (v: number | null | undefined, suffix: string): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? `${Number(v.toFixed(1))} ${suffix}`.trim() : null;

/**
 * Sobrepõe à ficha os campos que vêm do CADASTRO e das MEDIÇÕES (E11) — o que
 * o banco sabe vale mais que o que o modelo ouviu: peso dito de cabeça na
 * conversa não substitui a balança. Só sobrescreve o que o sistema realmente
 * tem; onde não tem, preserva o que a IA extraiu (peso máximo da vida, por
 * exemplo, só existe na conversa).
 */
export function applyKnownFields(form: ConsultationForm, known: KnownFields): ConsultationForm {
  const pick = <T>(system: T | null | undefined, extracted: string | null): string | null =>
    system === null || system === undefined || system === '' ? extracted : String(system);
  return {
    ...form,
    identificacao: {
      ...form.identificacao,
      nome: pick(known.nome, form.identificacao.nome),
      idade: pick(known.idade, form.identificacao.idade),
      profissao: pick(known.profissao, form.identificacao.profissao),
      telefone: pick(known.telefone, form.identificacao.telefone),
      data: pick(known.data, form.identificacao.data),
    },
    antropometria: {
      ...form.antropometria,
      pesoAtual: num(known.pesoKg, 'kg') ?? form.antropometria.pesoAtual,
      altura: num(known.alturaCm, 'cm') ?? form.antropometria.altura,
      imc: num(known.imc, '') ?? form.antropometria.imc,
    },
  };
}
