/**
 * Corpus de regressão da resolução de alimentos (E16).
 *
 * Este arquivo é o artefato mais importante do épico. Sem ele, qualquer ajuste no
 * score da busca lexical é chute: melhora um caso e quebra três em silêncio, e
 * ninguém percebe porque o resultado errado continua sendo um alimento plausível.
 *
 * Os casos marcados `regressao: true` são erros REAIS medidos no código de
 * produção em 2026-08-06, com o paciente-piloto usando o bot para conduzir a
 * dieta. Eles não são hipóteses — cada um foi observado.
 *
 * COMO ACRESCENTAR: viu o bot errar um alimento? A primeira ação é uma linha
 * aqui, ANTES de mexer em qualquer heurística.
 */

export interface CorpusCase {
  /** O que o paciente digita. */
  readonly term: string;
  /** Trecho que DEVE aparecer na descrição do alimento resolvido. */
  readonly expect: string;
  /** Trecho que NÃO pode aparecer — é o erro que estamos impedindo. */
  readonly reject?: string;
  /** true ⇒ erro observado em produção, não caso hipotético. */
  readonly regressao?: boolean;
  /** Por que este caso importa (aparece na mensagem de falha do teste). */
  readonly nota?: string;
}

export const CORPUS: readonly CorpusCase[] = [
  // ── Os 8 erros medidos em produção ───────────────────────────────────────
  {
    term: 'frango grelhado',
    expect: 'peito',
    reject: 'coração',
    regressao: true,
    nota: 'casava com "Frango, coração, grelhado": proteína −30%, gordura +385%',
  },
  {
    term: 'arroz branco',
    expect: 'Arroz, tipo 1, cozido',
    reject: 'carreteiro',
    regressao: true,
    nota: 'casava com "Arroz carreteiro": proteína 4,3× e gordura 35×',
  },
  {
    term: 'arroz',
    expect: 'Arroz, tipo 1, cozido',
    reject: 'carreteiro',
    regressao: true,
    nota: 'o alimento mais registrado do país caindo em prato com carne-seca',
  },
  {
    term: 'banana',
    expect: 'Banana, prata, crua',
    reject: 'doce em barra',
    regressao: true,
    nota: 'casava com bananada (280 kcal): a penalidade contra "cru" punia toda fruta',
  },
  {
    term: 'leite desnatado',
    expect: 'desnatado, líquido',
    reject: 'pó',
    regressao: true,
    nota: 'casava com leite em PÓ (362 kcal contra ~35 do líquido) — 10×',
  },
  {
    term: 'macarrao',
    expect: 'Macarrão cozido',
    regressao: true,
    nota: 'RELATADO PELO PILOTO: "coloquei 90g de macarrão e ele disse que não tinha". A TACO só ' +
      'tem massa CRUA (371 kcal); cozida absorve água e cai para ~158 — fator 2,4×',
  },
  {
    term: 'aveia',
    expect: 'Aveia, flocos',
    reject: 'Pão',
    regressao: true,
    nota: 'casava com "Pão, aveia, forma"',
  },
  {
    term: 'tapioca',
    expect: 'Goma de tapioca hidratada',
    reject: 'manteiga',
    regressao: true,
    nota: 'casava com "Tapioca, com manteiga" (348 kcal, com gordura que ninguém pôs)',
  },
  {
    term: 'carne moida',
    expect: 'moído',
    reject: 'Estrogonofe',
    regressao: true,
    nota: 'casava com "Estrogonofe de carne"',
  },
  {
    term: 'file de tilapia',
    expect: 'Tilápia',
    reject: 'Merluza',
    regressao: true,
    nota: 'casava com "Merluza, filé, frito" — peixe errado E preparo errado',
  },

  // ── Suplementos: a TACO não tem nenhum ───────────────────────────────────
  { term: 'whey protein isolado', expect: 'isolado', regressao: true, nota: 'o paciente relatou "não tem na tabela"' },
  { term: 'whey', expect: 'concentrado' },
  { term: 'whey protein', expect: 'concentrado' },
  { term: 'creatina', expect: 'Creatina', nota: 'tem que resolver para 0 kcal — ver corpus.test.ts' },
  { term: 'albumina', expect: 'Albumina' },

  // ── Carnes: cortes que a busca lexical confundia ─────────────────────────
  { term: 'peito de frango', expect: 'peito', reject: 'coração' },
  { term: 'file de frango', expect: 'peito', reject: 'coração' },
  { term: 'frango', expect: 'peito', reject: 'açafrão' },
  { term: 'frango assado', expect: 'assado' },
  { term: 'coxa de frango', expect: 'coxa' },
  { term: 'sobrecoxa', expect: 'sobrecoxa' },
  { term: 'carne', expect: 'patinho', reject: 'Estrogonofe' },
  { term: 'patinho', expect: 'patinho' },
  { term: 'alcatra', expect: 'alcatra' },
  { term: 'picanha', expect: 'picanha' },
  // A TACO grafa "filé mingnon" (typo da fonte). Preservamos a grafia da tabela
  // em vez de "corrigir" o dado — o catálogo é quem traduz o termo do paciente.
  { term: 'file mignon', expect: 'mingnon' },
  { term: 'bife', expect: 'patinho', nota: 'antes ia para contra-filé por sinônimo hardcoded' },
  { term: 'figado', expect: 'fígado' },
  { term: 'carne seca', expect: 'seca' },

  // ── Pescados ─────────────────────────────────────────────────────────────
  { term: 'salmao', expect: 'Salmão', reject: 'cru' },
  { term: 'salmao grelhado', expect: 'grelhado' },
  { term: 'atum', expect: 'Atum', nota: 'genérico = lata, que é como se consome' },
  { term: 'sardinha', expect: 'Sardinha' },

  // ── Cereais, massas e tubérculos ─────────────────────────────────────────
  { term: 'arroz integral', expect: 'integral', reject: 'cru' },
  { term: 'aveia em flocos', expect: 'Aveia' },
  { term: 'pao frances', expect: 'francês' },
  { term: 'pao integral', expect: 'integral' },
  { term: 'pao de queijo', expect: 'queijo' },
  { term: 'cuscuz', expect: 'Cuscuz' },
  { term: 'mandioca', expect: 'Mandioca, cozida', reject: 'crua' },
  { term: 'batata', expect: 'inglesa, cozida', reject: 'frita' },
  { term: 'batata doce', expect: 'doce, cozida' },
  { term: 'batata frita', expect: 'frita' },
  { term: 'espaguete', expect: 'Macarrão cozido' },
  { term: 'macarrao integral', expect: 'integral', reject: 'instantâneo' },
  { term: 'goma de tapioca', expect: 'Goma de tapioca' },
  { term: 'polvilho', expect: 'Polvilho' },

  // ── Leguminosas ──────────────────────────────────────────────────────────
  { term: 'feijao', expect: 'carioca, cozido', reject: 'cru' },
  { term: 'feijao preto', expect: 'preto, cozido', reject: 'cru' },
  { term: 'lentilha', expect: 'Lentilha, cozida', reject: 'crua' },
  { term: 'grao de bico', expect: 'Grão-de-bico cozido', reject: 'cru' },

  // ── Ovos e laticínios ────────────────────────────────────────────────────
  { term: 'ovo', expect: 'inteiro, cozido' },
  { term: 'ovo cozido', expect: 'cozido' },
  { term: 'clara de ovo', expect: 'clara' },
  { term: 'ovos mexidos', expect: 'frito', nota: 'aproximação aceita: TACO não tem mexido' },
  { term: 'iogurte natural', expect: 'Iogurte, natural' },
  { term: 'iogurte grego', expect: 'sobremesa', nota: 'no BR "grego" é sobremesa láctea: ~5 g P e ~15 g C' },
  { term: 'yopro', expect: 'proteico', nota: 'coado de verdade: ~11 g P e ~3 g C — outro alimento' },
  { term: 'queijo minas', expect: 'minas' },
  { term: 'mussarela', expect: 'mozarela' },
  { term: 'parmesao', expect: 'parmesão' },
  { term: 'ricota', expect: 'ricota' },

  // ── Gorduras e oleaginosas ───────────────────────────────────────────────
  { term: 'azeite', expect: 'oliva', reject: 'dendê' },
  { term: 'azeite de oliva', expect: 'oliva' },
  { term: 'manteiga', expect: 'Manteiga', reject: 'Couve' },
  { term: 'pasta de amendoim', expect: 'Pasta de amendoim' },
  { term: 'amendoim', expect: 'Amendoim' },
  { term: 'castanha de caju', expect: 'caju' },

  // ── Frutas: todas eram punidas pela penalidade de "cru" ──────────────────
  { term: 'banana prata', expect: 'prata' },
  { term: 'banana nanica', expect: 'nanica' },
  { term: 'maca', expect: 'Maçã', reject: 'Macarrão' },
  { term: 'laranja', expect: 'Laranja', reject: 'Refrigerante' },
  { term: 'mamao', expect: 'Mamão', reject: 'calda' },
  { term: 'melancia', expect: 'Melancia' },
  { term: 'morango', expect: 'Morango, cru', reject: 'Biscoito' },
  { term: 'uva', expect: 'Uva', reject: 'suco' },
  { term: 'manga', expect: 'Manga', reject: 'Cajá' },
  { term: 'abacaxi', expect: 'Abacaxi', reject: 'congelada' },
  { term: 'goiaba', expect: 'Goiaba', reject: 'doce' },
  { term: 'abacate', expect: 'Abacate' },
  { term: 'pera', expect: 'Pêra', reject: 'Laranja' },

  // ── Verduras e legumes ───────────────────────────────────────────────────
  { term: 'alface', expect: 'Alface' },
  { term: 'tomate', expect: 'Tomate', reject: 'extrato' },
  { term: 'brocolis', expect: 'Brócolis' },
  { term: 'cenoura', expect: 'Cenoura' },
  { term: 'abobrinha', expect: 'Abobrinha' },
  { term: 'beterraba', expect: 'Beterraba' },
  { term: 'couve', expect: 'Couve, manteiga', reject: 'flor' },

  // ── Bebidas ──────────────────────────────────────────────────────────────
  { term: 'cafe', expect: 'Café, infusão', reject: 'pó' },
  { term: 'suco de laranja', expect: 'suco' },
  { term: 'leite', expect: 'integral, líquido', reject: 'pó' },
  { term: 'leite integral', expect: 'integral, líquido' },

  // ── 2ª varredura (2026-08-06): matches silenciosamente errados ───────────
  // Achados rodando ~150 termos do cardápio brasileiro contra o resolvedor.
  // Todos resolviam com CONFIANÇA — nada sinalizava o erro ao paciente.
  { term: 'salada', expect: 'Alface', reject: 'maionese', nota: 'caía em "Salada, de legumes, COM MAIONESE"' },
  { term: 'camarao', expect: 'Camarão, Rio Grande', reject: 'baiana', nota: 'caía em "Camarão à baiana", um prato' },
  { term: 'limao', expect: 'tahiti, cru', reject: 'suco', nota: 'a fruta, não o suco' },
  { term: 'tangerina', expect: 'Poncã, crua', reject: 'suco' },
  { term: 'berinjela', expect: 'cozida', reject: 'crua' },
  { term: 'chuchu', expect: 'cozido' },
  { term: 'ervilha', expect: 'enlatada', reject: 'em vagem' },
  { term: 'peixe', expect: 'Tilápia', nota: 'genérico ⇒ o peixe mais consumido no país' },

  // ── 2ª varredura: alimentos que a TACO tem com OUTRO nome ───────────────
  { term: 'bolacha', expect: 'Biscoito', nota: 'a TACO só diz "biscoito"' },
  { term: 'strogonoff', expect: 'Estrogonofe', nota: 'a TACO grafa "estrogonofe"' },
  { term: 'bacon', expect: 'Toucinho', nota: 'a TACO só diz "toucinho"' },
  { term: 'nozes', expect: 'Noz', nota: 'falhava: a singularização corta o "s" e produz "noze"' },

  // ── 2ª varredura: não é alimento ────────────────────────────────────────
  { term: 'agua', expect: 'BLOQUEADO', nota: 'caía em "Coco, água de"; e água não entra na contagem' },

  // ── 3ª leva (2026-08-07): modernos e preparados que a TACO de 2011 não tem ──
  { term: 'granola', expect: 'Granola' },
  { term: 'quinoa', expect: 'Quinoa cozida', reject: 'crua' },
  { term: 'chia', expect: 'Chia' },
  { term: 'salsicha', expect: 'Salsicha', nota: 'USDA publica 1350 kJ; embarcado como 323 kcal' },
  { term: 'sorvete', expect: 'Sorvete', nota: 'USDA publica 868 kJ; embarcado como 207 kcal' },
  { term: 'pizza', expect: 'Pizza', nota: 'USDA publica 1120 kJ; embarcado como 268 kcal' },
  { term: 'panqueca', expect: 'Panqueca' },
  { term: 'vinho', expect: 'Vinho tinto', nota: 'álcool: 7 kcal/g fora de todo macro' },
];

/** Marcador de que o termo deve ser RECUSADO, não resolvido. */
export const BLOCKED = 'BLOQUEADO';
