/**
 * Catálogo curado de alimentos (E16) — termo do paciente → item CANÔNICO.
 *
 * Existe porque a busca lexical sobre a TACO, sozinha, escolhe o alimento errado
 * de forma sistemática. Medido no código de produção antes desta correção:
 * "frango grelhado" casava com **Frango, coração, grelhado** (proteína −30%,
 * gordura +385%), "arroz branco" com **Arroz carreteiro** (proteína 4,3×),
 * "banana" com **Banana, doce em barra** (kcal 2,9×) e "leite desnatado" com o
 * leite em **pó** (kcal ~10×).
 *
 * A razão é estrutural, não um bug pontual: similaridade de string não sabe qual
 * alimento as pessoas COMEM. "Frango, coração, grelhado" tem descrição mais curta
 * que "Frango, peito, sem pele, grelhado", e brevidade era premiada. Nenhum ajuste
 * de peso resolve isso em geral — o que resolve é dizer, explicitamente, qual é o
 * item canônico para os termos que aparecem de fato num recordatório.
 *
 * Mesmo padrão do `@nutrimed/lab-catalog` (E14), e pela mesma razão: um vocabulário
 * curado à mão vale mais que uma heurística esperta.
 *
 * O catálogo **não é um gate**: termo fora dele continua indo para a busca lexical
 * (que segue existindo e foi corrigida). Ele é o atalho determinístico para o que
 * é comum — e o comum é a maior parte do volume.
 *
 * REGRA DE CURADORIA: quando o termo é genérico ("frango", "arroz", "atum"), o
 * canônico é a forma MAIS CONSUMIDA no Brasil, não a mais "correta". Quem digita
 * "atum" quer a lata. O bot mostra o que entendeu (`itemsLabel`), então o paciente
 * corrige quando erramos — e essa é a razão de podermos escolher um default.
 */

/** Referência ao item canônico: TACO por id, ou tabela própria (`nm-*`). */
export interface FoodRef {
  readonly source: 'taco' | 'nutrimed';
  readonly id: string;
}

export interface FoodAlias {
  /** Chave estável e legível — aparece em log e teste, não na tela. */
  readonly slug: string;
  readonly ref: FoodRef;
  /** Grafias que casam com este item. O `slug` NÃO casa implicitamente. */
  readonly synonyms: readonly string[];
}

const taco = (id: string): FoodRef => ({ source: 'taco', id });
const nm = (id: string): FoodRef => ({ source: 'nutrimed', id });

/**
 * Normalização das chaves de busca: minúsculas, sem acento, sem pontuação,
 * espaços colapsados, e sem as preposições/artigos que o paciente escreve no meio
 * ("peito de frango" e "peito frango" têm que cair no mesmo lugar).
 */
export function normalizeTerm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STRIPPED_WORDS.has(t))
    .join(' ')
    .trim();
}

/** Palavras sem valor discriminante — some do termo antes do match. */
const STRIPPED_WORDS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'a', 'o', 'as', 'os', 'um', 'uma', 'com', 'em', 'no', 'na',
]);

export const FOOD_CATALOG: readonly FoodAlias[] = [
  // ── Carnes brancas ───────────────────────────────────────────────────────
  {
    // O caso que originou o épico. Genérico "frango" vai para o PEITO grelhado:
    // é o corte da dieta, e era o que o paciente queria quando o sistema lhe
    // deu coração de galinha.
    slug: 'frango-peito-grelhado',
    ref: taco('410'),
    synonyms: [
      'frango', 'frango grelhado', 'peito de frango', 'peito de frango grelhado',
      'file de frango', 'file de frango grelhado', 'peito frango grelhado',
      'frango na chapa', 'frango grelhado sem pele', 'blanquet de frango',
    ],
  },
  { slug: 'frango-peito-cozido', ref: taco('408'), synonyms: ['frango cozido', 'peito de frango cozido', 'frango desfiado'] },
  { slug: 'frango-assado', ref: taco('403'), synonyms: ['frango assado', 'frango inteiro assado', 'frango de padaria'] },
  { slug: 'frango-coxa', ref: taco('398'), synonyms: ['coxa de frango', 'coxa', 'coxa de frango cozida'] },
  { slug: 'frango-sobrecoxa', ref: taco('413'), synonyms: ['sobrecoxa', 'sobrecoxa de frango', 'sobrecoxa assada'] },
  { slug: 'frango-milanesa', ref: taco('401'), synonyms: ['frango a milanesa', 'file de frango a milanesa', 'frango empanado'] },
  { slug: 'frango-coracao', ref: taco('395'), synonyms: ['coracao de frango', 'coracao de galinha'] },
  { slug: 'frango-figado', ref: taco('400'), synonyms: ['figado de frango', 'figado de galinha'] },

  // ── Carnes vermelhas ─────────────────────────────────────────────────────
  {
    // "carne" genérico → patinho grelhado: corte magro usual de dieta, e o que
    // a busca lexical nunca acertava (ela caía em estrogonofe/pastel).
    slug: 'carne-patinho-grelhado',
    ref: taco('377'),
    synonyms: ['carne', 'carne bovina', 'carne vermelha', 'patinho', 'patinho grelhado', 'bife', 'bife grelhado', 'file'],
  },
  { slug: 'carne-moida', ref: taco('326'), synonyms: ['carne moida', 'carne moida cozida', 'patinho moido', 'acem moido'] },
  { slug: 'carne-alcatra', ref: taco('370'), synonyms: ['alcatra', 'miolo de alcatra', 'alcatra grelhada'] },
  { slug: 'carne-picanha', ref: taco('381'), synonyms: ['picanha', 'picanha grelhada'] },
  { slug: 'carne-file-mignon', ref: taco('358'), synonyms: ['file mignon', 'filet mignon', 'mignon'] },
  { slug: 'carne-contra-file', ref: taco('346'), synonyms: ['contra file', 'contrafile'] },
  { slug: 'carne-coxao-mole', ref: taco('351'), synonyms: ['coxao mole', 'chã de dentro'] },
  { slug: 'carne-lagarto', ref: taco('363'), synonyms: ['lagarto', 'lagarto cozido'] },
  { slug: 'carne-musculo', ref: taco('371'), synonyms: ['musculo', 'musculo cozido'] },
  { slug: 'carne-maminha', ref: taco('368'), synonyms: ['maminha', 'maminha grelhada'] },
  { slug: 'carne-costela', ref: taco('347'), synonyms: ['costela', 'costela assada', 'costela bovina'] },
  { slug: 'carne-seca', ref: taco('384'), synonyms: ['carne seca', 'charque', 'carne de sol'] },
  { slug: 'carne-figado', ref: taco('356'), synonyms: ['figado', 'figado grelhado', 'figado bovino', 'figado acebolado'] },

  // ── Pescados ─────────────────────────────────────────────────────────────
  { slug: 'salmao-grelhado', ref: taco('317'), synonyms: ['salmao', 'salmao grelhado', 'file de salmao'] },
  {
    // Peixe mais consumido no Brasil e ausente da TACO. "peixe" genérico cai
    // aqui: é o palpite menos ruim e o bot mostra o que entendeu.
    slug: 'tilapia',
    ref: nm('nm-tilapia'),
    synonyms: ['tilapia', 'file de tilapia', 'tilapia grelhada', 'peixe', 'file de peixe', 'peixe grelhado'],
  },
  { slug: 'atum-conserva', ref: taco('277'), synonyms: ['atum', 'atum em lata', 'atum enlatado', 'lata de atum'] },
  { slug: 'atum-fresco', ref: taco('278'), synonyms: ['atum fresco', 'file de atum'] },
  { slug: 'sardinha-conserva', ref: taco('319'), synonyms: ['sardinha', 'sardinha em lata', 'sardinha enlatada'] },
  { slug: 'sardinha-assada', ref: taco('318'), synonyms: ['sardinha assada', 'sardinha fresca'] },
  // "camarão" caía em "Camarão à baiana" — um PRATO (com leite de coco e dendê),
  // não o camarão que o paciente comeu.
  { slug: 'camarao-cozido', ref: taco('284'), synonyms: ['camarao', 'camarao cozido', 'camaroes'] },
  { slug: 'merluza-assada', ref: taco('301'), synonyms: ['merluza', 'merluza assada', 'file de merluza'] },
  { slug: 'pescada', ref: taco('308'), synonyms: ['pescada', 'file de pescada'] },

  // ── Cereais e massas ─────────────────────────────────────────────────────
  {
    // "arroz" genérico → tipo 1 cozido. Antes caía em Arroz carreteiro, que tem
    // 4,3× a proteína e 35× a gordura do arroz branco — o erro mais grosseiro
    // do conjunto, porque arroz é o alimento mais registrado do país.
    slug: 'arroz-branco-cozido',
    ref: taco('3'),
    synonyms: ['arroz', 'arroz branco', 'arroz cozido', 'arroz branco cozido', 'arroz tipo 1', 'arroz polido'],
  },
  { slug: 'arroz-integral-cozido', ref: taco('1'), synonyms: ['arroz integral', 'arroz integral cozido'] },
  { slug: 'aveia-flocos', ref: taco('7'), synonyms: ['aveia', 'aveia em flocos', 'flocos de aveia', 'farelo de aveia', 'aveia flocos'] },
  { slug: 'pao-frances', ref: taco('53'), synonyms: ['pao', 'pao frances', 'pao de sal', 'paozinho', 'frances'] },
  { slug: 'pao-integral', ref: taco('52'), synonyms: ['pao integral', 'pao de forma integral', 'pao de trigo integral'] },
  { slug: 'pao-forma', ref: taco('54'), synonyms: ['pao de forma', 'pao sovado', 'pao branco'] },
  { slug: 'pao-queijo', ref: taco('140'), synonyms: ['pao de queijo'] },
  { slug: 'tapioca-goma', ref: nm('nm-goma-tapioca'), synonyms: ['tapioca', 'goma de tapioca', 'massa de tapioca', 'goma'] },
  {
    // A TACO só tem massa CRUA (371 kcal). Cozida absorve água e cai para ~158 —
    // fator 2,4×. É o alimento que o piloto tentou registrar primeiro.
    slug: 'macarrao-cozido',
    ref: nm('nm-macarrao-cozido'),
    synonyms: [
      'macarrao', 'macarrao cozido', 'espaguete', 'espaguete cozido', 'massa', 'massas',
      'talharim', 'penne', 'parafuso', 'fusilli', 'macarrao comum',
    ],
  },
  {
    slug: 'macarrao-integral-cozido',
    ref: nm('nm-macarrao-integral-cozido'),
    synonyms: ['macarrao integral', 'massa integral', 'espaguete integral'],
  },
  { slug: 'polvilho-doce', ref: taco('146'), synonyms: ['polvilho', 'polvilho doce', 'fecula de mandioca'] },
  { slug: 'cuscuz-milho', ref: taco('533'), synonyms: ['cuscuz', 'cuscuz de milho', 'cuscuz nordestino'] },
  { slug: 'granola', ref: nm('nm-granola'), synonyms: ['granola', 'granola tradicional'] },
  { slug: 'quinoa', ref: nm('nm-quinoa-cozida'), synonyms: ['quinoa', 'quinua', 'quinoa cozida'] },
  { slug: 'panqueca', ref: nm('nm-panqueca'), synonyms: ['panqueca', 'panquecas', 'panqueca simples'] },
  { slug: 'pizza', ref: nm('nm-pizza-mussarela'), synonyms: ['pizza', 'pizza de mussarela', 'fatia de pizza'] },
  { slug: 'farinha-mandioca', ref: taco('122'), synonyms: ['farinha', 'farinha de mandioca', 'farofa pronta'] },
  { slug: 'mandioca-cozida', ref: taco('129'), synonyms: ['mandioca', 'mandioca cozida', 'aipim', 'macaxeira'] },
  { slug: 'milho-verde', ref: taco('45'), synonyms: ['milho', 'milho verde', 'milho em conserva', 'milho enlatado'] },

  // ── Leguminosas ──────────────────────────────────────────────────────────
  {
    slug: 'feijao-carioca-cozido',
    ref: taco('561'),
    synonyms: ['feijao', 'feijao carioca', 'feijao cozido', 'feijao carioca cozido', 'caldo de feijao'],
  },
  { slug: 'feijao-preto-cozido', ref: taco('567'), synonyms: ['feijao preto', 'feijao preto cozido'] },
  { slug: 'feijao-fradinho', ref: taco('563'), synonyms: ['feijao fradinho', 'fradinho', 'feijao de corda'] },
  { slug: 'lentilha-cozida', ref: taco('577'), synonyms: ['lentilha', 'lentilha cozida'] },
  { slug: 'soja-tofu', ref: taco('584'), synonyms: ['tofu', 'queijo de soja'] },
  {
    slug: 'grao-de-bico-cozido',
    ref: nm('nm-grao-de-bico-cozido'),
    synonyms: ['grao de bico', 'grao bico', 'grao de bico cozido'],
  },

  // ── Ovos ─────────────────────────────────────────────────────────────────
  { slug: 'ovo-cozido', ref: taco('488'), synonyms: ['ovo', 'ovo cozido', 'ovos', 'ovo de galinha', 'ovo inteiro'] },
  { slug: 'ovo-frito', ref: taco('490'), synonyms: ['ovo frito', 'ovo mexido', 'ovos mexidos'] },
  { slug: 'ovo-clara', ref: taco('486'), synonyms: ['clara', 'clara de ovo', 'claras'] },
  { slug: 'ovo-gema', ref: taco('487'), synonyms: ['gema', 'gema de ovo'] },
  { slug: 'clara-pasteurizada', ref: nm('nm-clara-pasteurizada'), synonyms: ['clara pasteurizada', 'clara liquida', 'clara de ovo pasteurizada'] },
  { slug: 'ovo-liquido', ref: nm('nm-ovo-liquido'), synonyms: ['ovo liquido', 'ovo pasteurizado', 'ovo integral pasteurizado'] },

  // ── Laticínios ───────────────────────────────────────────────────────────
  {
    // A TACO só analisou leite em PÓ (362 kcal/100 g). "leite" genérico vai para
    // o INTEGRAL: é o mais consumido, e o paciente que toma desnatado costuma
    // dizer "desnatado".
    slug: 'leite-integral',
    ref: nm('nm-leite-integral'),
    synonyms: ['leite', 'leite integral', 'leite de vaca', 'copo de leite'],
  },
  { slug: 'leite-desnatado', ref: nm('nm-leite-desnatado'), synonyms: ['leite desnatado', 'leite zero'] },
  {
    slug: 'leite-semidesnatado',
    ref: nm('nm-leite-semidesnatado'),
    synonyms: ['leite semidesnatado', 'leite semi desnatado'],
  },
  { slug: 'iogurte-natural', ref: taco('448'), synonyms: ['iogurte', 'iogurte natural', 'iogurte integral'] },
  { slug: 'iogurte-desnatado', ref: taco('449'), synonyms: ['iogurte desnatado', 'iogurte natural desnatado', 'iogurte light'] },
  {
    // Default = a SOBREMESA de gôndola, porque é o que "grego" significa no
    // supermercado brasileiro (não há padrão de identidade legal). Tem ~11 g de
    // açúcar adicionado e proteína igual à do iogurte comum.
    slug: 'iogurte-grego-sobremesa',
    ref: nm('nm-iogurte-grego-sobremesa'),
    synonyms: ['iogurte grego', 'grego', 'iogurte grego tradicional'],
  },
  {
    slug: 'iogurte-grego-proteico',
    ref: nm('nm-iogurte-grego-proteico'),
    synonyms: ['iogurte grego proteico', 'iogurte proteico', 'yopro', 'yorgus', 'iogurte grego zero', 'iogurte alto teor proteico'],
  },
  { slug: 'queijo-minas', ref: taco('461'), synonyms: ['queijo minas', 'queijo branco', 'minas frescal', 'queijo frescal'] },
  { slug: 'queijo-mussarela', ref: taco('463'), synonyms: ['queijo', 'mussarela', 'mozarela', 'queijo mussarela'] },
  { slug: 'queijo-prato', ref: taco('467'), synonyms: ['queijo prato'] },
  { slug: 'queijo-parmesao', ref: taco('464'), synonyms: ['parmesao', 'queijo parmesao', 'queijo ralado'] },
  { slug: 'queijo-ricota', ref: taco('469'), synonyms: ['ricota', 'queijo ricota'] },

  // ── Suplementos ──────────────────────────────────────────────────────────
  {
    // Genérico "whey" → concentrado: é o mais vendido. Isolado tem entrada
    // própria porque a diferença é grande (P 83 vs 70, C 5 vs 15).
    slug: 'whey-concentrado',
    ref: nm('nm-whey-concentrado'),
    synonyms: ['whey', 'whey protein', 'whey concentrado', 'whey protein concentrado', 'proteina do soro', 'wpc'],
  },
  {
    slug: 'whey-isolado',
    ref: nm('nm-whey-isolado'),
    synonyms: ['whey isolado', 'whey protein isolado', 'iso whey', 'whey iso', 'proteina isolada', 'wpi'],
  },
  { slug: 'creatina', ref: nm('nm-creatina'), synonyms: ['creatina', 'creatina monohidratada', 'creatine'] },
  { slug: 'albumina', ref: nm('nm-albumina'), synonyms: ['albumina', 'albumina em po', 'clara desidratada'] },

  // ── Gorduras ─────────────────────────────────────────────────────────────
  { slug: 'azeite-oliva', ref: taco('260'), synonyms: ['azeite', 'azeite de oliva', 'azeite extra virgem', 'oleo de oliva'] },
  { slug: 'manteiga', ref: taco('261'), synonyms: ['manteiga', 'manteiga com sal'] },
  { slug: 'pasta-amendoim', ref: nm('nm-pasta-amendoim'), synonyms: ['pasta de amendoim', 'pasta amendoim', 'peanut butter', 'manteiga de amendoim'] },

  // ── Oleaginosas ──────────────────────────────────────────────────────────
  { slug: 'amendoim', ref: taco('557'), synonyms: ['amendoim', 'amendoim cru'] },
  { slug: 'castanha-caju', ref: taco('588'), synonyms: ['castanha de caju', 'caju torrado'] },
  { slug: 'castanha-para', ref: taco('589'), synonyms: ['castanha do para', 'castanha do brasil', 'castanha'] },
  // "nozes" não casava com "Noz, crua": a singularização ingênua do tokenizador
  // corta o 's' final e produz "noze", que não existe em lugar nenhum.
  { slug: 'noz', ref: taco('597'), synonyms: ['nozes', 'noz', 'noz crua'] },
  { slug: 'amendoa', ref: taco('586'), synonyms: ['amendoa', 'amendoas'] },
  { slug: 'chia', ref: nm('nm-chia'), synonyms: ['chia', 'semente de chia'] },

  // ── Tubérculos e legumes ─────────────────────────────────────────────────
  { slug: 'batata-cozida', ref: taco('91'), synonyms: ['batata', 'batata inglesa', 'batata cozida', 'batata inglesa cozida'] },
  { slug: 'batata-doce', ref: taco('88'), synonyms: ['batata doce', 'batata doce cozida'] },
  { slug: 'batata-frita', ref: taco('93'), synonyms: ['batata frita', 'fritas'] },
  { slug: 'batata-baroa', ref: taco('86'), synonyms: ['batata baroa', 'mandioquinha', 'batata salsa'] },
  { slug: 'brocolis-cozido', ref: taco('100'), synonyms: ['brocolis', 'brocolis cozido', 'brocolis no vapor'] },
  { slug: 'cenoura-crua', ref: taco('110'), synonyms: ['cenoura', 'cenoura crua', 'cenoura ralada'] },
  { slug: 'cenoura-cozida', ref: taco('109'), synonyms: ['cenoura cozida'] },
  { slug: 'abobrinha-cozida', ref: taco('70'), synonyms: ['abobrinha', 'abobrinha cozida', 'abobrinha italiana'] },
  { slug: 'beterraba-cozida', ref: taco('97'), synonyms: ['beterraba', 'beterraba cozida'] },
  {
    // "salada" caía em "Salada, de legumes, COM MAIONESE" (96 kcal, 7 g de
    // gordura) — quem digita "salada" quase nunca quer maionese junto.
    slug: 'alface',
    ref: taco('78'),
    synonyms: ['alface', 'alface crespa', 'folhas', 'salada de alface', 'salada', 'salada verde', 'folhas verdes'],
  },
  { slug: 'salada-legumes-vapor', ref: taco('546'), synonyms: ['salada de legumes', 'legumes cozidos', 'legumes no vapor'] },
  { slug: 'berinjela-cozida', ref: taco('95'), synonyms: ['berinjela', 'berinjela cozida'] },
  { slug: 'chuchu-cozido', ref: taco('112'), synonyms: ['chuchu', 'chuchu cozido'] },
  { slug: 'repolho', ref: taco('149'), synonyms: ['repolho', 'repolho branco', 'repolho cru'] },
  { slug: 'ervilha', ref: taco('560'), synonyms: ['ervilha', 'ervilhas', 'ervilha em lata'] },
  { slug: 'espinafre-refogado', ref: taco('120'), synonyms: ['espinafre', 'espinafre refogado'] },
  { slug: 'tomate', ref: taco('157'), synonyms: ['tomate', 'tomate cru'] },
  { slug: 'couve-refogada', ref: taco('116'), synonyms: ['couve', 'couve refogada', 'couve manteiga'] },

  // ── Frutas ───────────────────────────────────────────────────────────────
  {
    // "banana" → prata crua (a mais consumida). Antes caía em "Banana, doce em
    // barra" — bananada, 280 kcal — porque a penalidade contra alimento "cru",
    // criada para evitar feijão cru, punia toda fruta fresca.
    slug: 'banana-prata',
    ref: taco('182'),
    synonyms: ['banana', 'banana prata', 'banana crua'],
  },
  { slug: 'banana-nanica', ref: taco('179'), synonyms: ['banana nanica', 'banana caturra', 'banana dagua'] },
  { slug: 'banana-terra', ref: taco('175'), synonyms: ['banana da terra', 'banana comprida'] },
  { slug: 'maca', ref: taco('222'), synonyms: ['maca', 'maca fuji', 'maca com casca'] },
  { slug: 'laranja', ref: taco('214'), synonyms: ['laranja', 'laranja pera'] },
  { slug: 'suco-laranja', ref: taco('215'), synonyms: ['suco de laranja', 'suco de laranja natural'] },
  { slug: 'mamao-papaia', ref: taco('226'), synonyms: ['mamao', 'mamao papaia', 'papaia'] },
  { slug: 'mamao-formosa', ref: taco('225'), synonyms: ['mamao formosa'] },
  { slug: 'melancia', ref: taco('235'), synonyms: ['melancia'] },
  { slug: 'melao', ref: taco('236'), synonyms: ['melao'] },
  { slug: 'morango', ref: taco('239'), synonyms: ['morango', 'morangos'] },
  { slug: 'uva', ref: taco('256'), synonyms: ['uva', 'uvas', 'uva italia'] },
  { slug: 'manga', ref: taco('231'), synonyms: ['manga', 'manga tommy'] },
  { slug: 'abacaxi', ref: taco('164'), synonyms: ['abacaxi'] },
  { slug: 'pera', ref: taco('243'), synonyms: ['pera'] },
  { slug: 'goiaba', ref: taco('200'), synonyms: ['goiaba', 'goiaba vermelha'] },
  { slug: 'abacate', ref: taco('163'), synonyms: ['abacate'] },

  { slug: 'limao', ref: taco('220'), synonyms: ['limao', 'limao tahiti'] },
  { slug: 'tangerina', ref: taco('251'), synonyms: ['tangerina', 'mexerica', 'bergamota', 'poncã', 'ponca'] },

  // ── Preparações e industrializados: nomes coloquiais ─────────────────────
  // A TACO usa grafias e nomes que ninguém digita. Sem estes alias os termos
  // simplesmente não casavam, embora o alimento ESTEJA na tabela.
  { slug: 'biscoito-doce', ref: taco('8'), synonyms: ['biscoito', 'bolacha', 'biscoito maisena', 'bolacha maisena'] },
  { slug: 'biscoito-cream-cracker', ref: taco('13'), synonyms: ['cream cracker', 'bolacha salgada', 'biscoito salgado', 'bolacha agua e sal'] },
  { slug: 'estrogonofe-carne', ref: taco('537'), synonyms: ['estrogonofe', 'strogonoff', 'estrogonofe de carne', 'strogonoff de carne'] },
  { slug: 'estrogonofe-frango', ref: taco('538'), synonyms: ['estrogonofe de frango', 'strogonoff de frango'] },
  { slug: 'toucinho', ref: taco('445'), synonyms: ['bacon', 'toucinho', 'toucinho frito'] },
  { slug: 'salsicha', ref: nm('nm-salsicha'), synonyms: ['salsicha', 'salsichas', 'cachorro quente'] },
  { slug: 'sorvete', ref: nm('nm-sorvete'), synonyms: ['sorvete', 'sorvete de creme', 'sorvete de baunilha'] },

  // ── Bebidas ──────────────────────────────────────────────────────────────
  { slug: 'cafe', ref: taco('471'), synonyms: ['cafe', 'cafe preto', 'cafe coado', 'cafezinho'] },
  {
    // Álcool tem 7 kcal/g e não aparece em nenhum macro — é a energia mais fácil
    // de esquecer num diário alimentar, e por isso vale estar aqui.
    slug: 'vinho-tinto',
    ref: nm('nm-vinho-tinto'),
    synonyms: ['vinho', 'vinho tinto', 'taca de vinho'],
  },
];

/**
 * Termos que NÃO são alimento para efeito de contagem nutricional. Merecem
 * resposta própria: "não encontrei água na tabela" seria um bug aos olhos do
 * paciente, e registrar água como alimento de 0 kcal poluiria o diário — o bot
 * foi deliberadamente restrito à ALIMENTAÇÃO em 2026-07-24 (água e sono saíram).
 */
export const NON_NUTRITIVE_TERMS: Readonly<Record<string, string>> = {
  agua: 'água não entra na contagem de calorias — não precisa registrar.',
  'agua mineral': 'água não entra na contagem de calorias — não precisa registrar.',
  'agua com gas': 'água não entra na contagem de calorias — não precisa registrar.',
  'cha sem acucar': 'chá sem açúcar não tem calorias relevantes — não precisa registrar.',
};

/**
 * Alimentos MUITO comuns que a TACO não tem e para os quais ainda não há valor
 * de fonte aceitável. Ficam bloqueados de propósito: sem isto, a busca lexical
 * os manda para o item errado, e errado por muito.
 *
 * "leite desnatado" casava com **Leite, de vaca, desnatado, PÓ** (362 kcal/100 g
 * contra ~35 do líquido) — 10× — porque a TACO só analisou o leite em pó. Dizer
 * "não tenho esse alimento" é honesto; registrar 10× a energia não é.
 *
 * Sai daqui assim que houver valor de fonte de licença compatível (USDA CC0).
 */
export const BLOCKED_TERMS: Readonly<Record<string, string>> = {
  requeijao: 'requeijão',
  'queijo cremoso': 'requeijão',
};

/** Índice sinônimo normalizado → alias. Construído uma vez, consulta O(1). */
const BY_SYNONYM = new Map<string, FoodAlias>();
for (const alias of FOOD_CATALOG) {
  for (const synonym of alias.synonyms) {
    const key = normalizeTerm(synonym);
    // Primeira ocorrência vence: a ordem do catálogo é a prioridade curada.
    if (key && !BY_SYNONYM.has(key)) BY_SYNONYM.set(key, alias);
  }
}

/** Busca exata (após normalização) no catálogo curado. */
export function lookupAlias(term: string): FoodAlias | null {
  return BY_SYNONYM.get(normalizeTerm(term)) ?? null;
}

// As chaves de BLOCKED_TERMS são escritas como o paciente digita ("leite de
// vaca"), mas a consulta é feita com o termo NORMALIZADO (que remove "de"). Sem
// este índice, "file de tilapia" viraria "file tilapia" e não casaria com a
// chave literal — o bloqueio falharia justamente nos termos com preposição.
const BLOCKED_BY_KEY = new Map<string, string>(
  Object.entries(BLOCKED_TERMS).map(([term, label]) => [normalizeTerm(term), label]),
);

/** Nome legível do alimento bloqueado, ou null se o termo não é bloqueado. */
export function blockedTerm(term: string): string | null {
  return BLOCKED_BY_KEY.get(normalizeTerm(term)) ?? null;
}

const NON_NUTRITIVE_BY_KEY = new Map<string, string>(
  Object.entries(NON_NUTRITIVE_TERMS).map(([term, msg]) => [normalizeTerm(term), msg]),
);

/** Mensagem para termo que não é alimento (água, chá sem açúcar), ou null. */
export function nonNutritiveTerm(term: string): string | null {
  return NON_NUTRITIVE_BY_KEY.get(normalizeTerm(term)) ?? null;
}

/** Só para teste/diagnóstico: quantos sinônimos o índice cobre. */
export function catalogSize(): { aliases: number; synonyms: number } {
  return { aliases: FOOD_CATALOG.length, synonyms: BY_SYNONYM.size };
}
