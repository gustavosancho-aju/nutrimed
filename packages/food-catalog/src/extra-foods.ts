/**
 * Alimentos que a TACO NÃO tem (E16). A TACO 4ª ed. é de 2011 e acadêmica: não
 * cobre suplemento nem industrializado moderno. Medido: `whey`, `proteína
 * isolada`, `creatina` e `albumina` dão ZERO ocorrência nos 591 alimentos — não é
 * falha de busca, é ausência de dado.
 *
 * PROVENIÊNCIA — só duas fontes entram aqui, e a escolha foi por LICENÇA:
 *  - `usda-cc0`     USDA FoodData Central, domínio público (CC0 1.0), sem
 *                   restrição territorial. É a base legalmente mais limpa.
 *  - `rotulo-anvisa` Rótulo brasileiro (RDC 429/2020 + IN 75/2020), transcrito de
 *                   fonte pública e conferido em 2+ fontes quando possível.
 *
 * O que ficou DE FORA, de propósito:
 *  - **TBCA (USP/FoRC)**: CC BY-NC-ND — uso comercial PROIBIDO, e o "ND" ainda
 *    impede redistribuir modificado. Normalizar para JSON já seria obra derivada.
 *    Só com licença paga negociada.
 *  - **Open Food Facts**: ODbL. O share-alike não pega o código, mas pega a fatia
 *    DERIVADA desta tabela — e o §4.6 obriga a publicar o banco alterado a quem
 *    recebe um "Produced Work" (o relatório do paciente). Não vale por ~10 itens.
 *
 * Os valores são por 100 g, MESMO shape de `TacoFood`, para que
 * `computeNutrition` não precise saber de onde vieram. `id` tem prefixo `nm-`
 * porque ele vira proveniência auditada (`store.ts` emite a fonte no kbSources) —
 * um número da TACO e um valor de rótulo NÃO podem se confundir na trilha.
 *
 * A `faixa` no comentário de cada item não é decoração: ela é o que justifica a
 * confiança. Item cuja faixa real é larga demais para um valor genérico (barra de
 * proteína: 294–504 kcal/100 g variando só com o SABOR) NÃO entra nesta tabela —
 * ver `AMBIGUOUS_FOODS`.
 */

/** De onde veio o número. Vai para a trilha de auditoria (NFR10). */
export type ExtraFoodSource = 'usda-cc0' | 'rotulo-anvisa';

export interface ExtraFood {
  /** Prefixo `nm-` — namespace próprio, nunca colide com id da TACO. */
  readonly id: string;
  readonly description: string;
  readonly category: string;
  readonly source: ExtraFoodSource;
  /** Referência humana da origem (fdcId do USDA, marca do rótulo). */
  readonly origin: string;
  readonly per100g: Readonly<Record<string, number>>;
}

/**
 * Versão da tabela, para proveniência. Sobe a cada mudança de VALOR (acrescentar
 * item também conta) — é ela que aparece no `model_version` do registro.
 */
export const EXTRA_FOODS_VERSION = 'nutrimed-2';

export const EXTRA_FOODS: readonly ExtraFood[] = [
  // ── Suplementos ──────────────────────────────────────────────────────────
  {
    // Faixa BR (5 marcas, porção 30 g): 353–373 kcal · P 80–87 · C 5–7 · G 0–3.
    // ATENÇÃO: a entrada USDA 173177 ("Whey protein powder isolate") declara
    // 58 g P e 29 g C — isso NÃO é isolado nenhum (isolado real tem ≥80% P e
    // ~5 g C); é uma bebida formulada, congelada no SR Legacy desde 2018.
    // Usá-la aqui erraria a proteína em ~30%. Por isso o valor vem de rótulo.
    id: 'nm-whey-isolado',
    description: 'Whey protein isolado, pó',
    category: 'Suplementos',
    source: 'rotulo-anvisa',
    origin: 'Média de 5 marcas BR (Max Titanium, Growth, Dux, Integralmédica, Nutripure)',
    per100g: { kcal: 360, protein: 83, carbs: 5, fat: 1 },
  },
  {
    // Faixa BR: 380–425 kcal · P 66,7–80 · C 9,3–21,7 · G 3,7–8,7.
    // O CARBOIDRATO é dominado pelo SABOR, não pela marca: sem sabor ≈ 6 g,
    // com sabor 9–22 g. O valor abaixo representa o produto de gôndola (com
    // sabor), que é o que o paciente toma.
    id: 'nm-whey-concentrado',
    description: 'Whey protein concentrado, pó',
    category: 'Suplementos',
    source: 'rotulo-anvisa',
    origin: 'Média de marcas BR com sabor (Max Titanium, Integralmédica, Growth, Dux)',
    per100g: { kcal: 405, protein: 70, carbs: 15, fat: 7 },
  },
  {
    // ZERO não é aproximação — é o que a IN 75/2020 (Anexo IV, "quantidade não
    // significativa") manda declarar e o que os rótulos BR declaram: Dux, 3VS,
    // Probiótica e Max Titanium trazem 0 kcal e só a linha "Creatina 3000 mg".
    //
    // Este item existe JUSTAMENTE para nunca ser buscado por similaridade.
    // Bases públicas trazem creatina com 88 g de "proteína" e 360 kcal/100 g —
    // artefato de Kjeldahl (a creatina tem 32% de nitrogênio, e o fator 6,25
    // converte isso em ~200 g de "proteína" fantasma). Num plano de 12 meses
    // isso viraria ~1,6 kg de proteína que não existe, com o dashboard
    // mostrando aderência proteica falsa e invisível no dia a dia.
    id: 'nm-creatina',
    description: 'Creatina monohidratada, pó',
    category: 'Suplementos',
    source: 'rotulo-anvisa',
    origin: 'IN 75/2020 Anexo IV + rótulos Dux/3VS/Probiótica/Max Titanium',
    per100g: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  },
  {
    // Naturovos: duas fontes independentes batendo dentro de 1%.
    // O SÓDIO é o dado clinicamente relevante que se perde se olharmos só
    // macros: ~1.280 mg/100 g (uma dose de 30 g entrega ~385 mg, ~20% do limite
    // diário da OMS). Nenhum whey chega perto. Muda conduta em hipertenso.
    id: 'nm-albumina',
    description: 'Albumina (clara de ovo desidratada), pó',
    category: 'Suplementos',
    source: 'rotulo-anvisa',
    origin: 'Naturovos (rótulo + Open Food Facts EAN 7896715607046, conferidos entre si)',
    per100g: { kcal: 343, protein: 78.6, carbs: 7.1, fat: 0, sodium: 1280 },
  },

  // ── Ovos processados ─────────────────────────────────────────────────────
  {
    // USDA 172203 (48/10,2/1,04/0,0) e rótulo Maxxi Ovos BR (44/10,0/1,0/0,0)
    // convergem. Faixa estreita ⇒ item de alta confiança.
    id: 'nm-clara-pasteurizada',
    description: 'Clara de ovo pasteurizada, líquida',
    category: 'Ovos e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 172203 (Egg, white, raw, frozen, pasteurized)',
    per100g: { kcal: 48, protein: 10.2, carbs: 1, fat: 0.1 },
  },
  {
    // USDA 323604 (150/12,3/0,91/10,3) e rótulo Netto BR (142/12,0/1,2/10,0)
    // batem dentro de 5%. Pasteurização não altera macros.
    id: 'nm-ovo-liquido',
    description: 'Ovo integral pasteurizado, líquido',
    category: 'Ovos e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 323604, conferido com rótulo Netto Alimentos',
    per100g: { kcal: 146, protein: 12.2, carbs: 1, fat: 10.2 },
  },

  // ── Industrializados comuns ──────────────────────────────────────────────
  {
    // Faixa BR (100% amendoim): 544–633 kcal · P 24,7–28 · C 7,7–20 · G 44–53.
    // Só vale para pasta 100% amendoim. Pasta "com whey"/sabor é OUTRO alimento
    // (Dr. Peanut Cookies & Cream: 33,5 g C contra 10,7 do 100% amendoim, e
    // ~25% menos proteína) — ver AMBIGUOUS_FOODS.
    //
    // Nota sobre o carboidrato: rótulo BR historicamente declara carboidrato
    // DISPONÍVEL (sem fibra) e o USDA usa "by difference" (COM fibra). Somando
    // a fibra o gap fecha (Mandubim 10,7 + 7,3 = 18,0 vs USDA 22,3). O valor
    // abaixo segue a convenção do rótulo BR, que é o que o paciente lê.
    id: 'nm-pasta-amendoim',
    description: 'Pasta de amendoim integral (100% amendoim)',
    category: 'Nozes e sementes',
    source: 'rotulo-anvisa',
    origin: 'Mandubim, Vitapower, Guimarães (média de marcas 100% amendoim)',
    per100g: { kcal: 610, protein: 26, carbs: 12, fat: 51, fiber: 7.5 },
  },
  {
    // A goma HIDRATADA (massa pronta de pacote) é ~60-65% do polvilho seco — o
    // resto é água. Confundir os dois erra por ~1,6×, e a TACO só tem o seco
    // ("Polvilho, doce", 351 kcal) e a preparação pronta COM MANTEIGA (348).
    // Aglomerado central dos rótulos: 215–244 kcal · C 53–60.
    //
    // Fonte secundária que circula com "68 kcal/100 g" está ERRADA: implicaria
    // ~83% de água e contradiz todos os rótulos de fabricante. Não usar.
    id: 'nm-goma-tapioca',
    description: 'Goma de tapioca hidratada (massa pronta)',
    category: 'Cereais e derivados',
    source: 'rotulo-anvisa',
    origin: 'Casas Pedro, Doce Mel, Norte (rótulos convergentes)',
    per100g: { kcal: 230, protein: 0, carbs: 57, fat: 0 },
  },

  // ── Básicos que a TACO só tem em forma NÃO-COMÍVEL ───────────────────────
  // A TACO analisou o macarrão CRU (371 kcal), o leite em PÓ (362) e o
  // grão-de-bico CRU (355). Ninguém come nenhum dos três assim. Sem estes itens,
  // "90 g de macarrão" ou "200 ml de leite" ou eram recusados ou entravam com
  // ~2,4× a energia real. Valores do USDA SR Legacy (domínio público, CC0);
  // citação canônica: https://fdc.nal.usda.gov/food-details/<fdcId>/nutrients
  {
    id: 'nm-macarrao-cozido',
    description: 'Macarrão cozido',
    category: 'Cereais e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 169737 (Pasta, cooked, enriched, without added salt)',
    per100g: { kcal: 158, protein: 5.8, carbs: 30.9, fat: 0.93 },
  },
  {
    id: 'nm-macarrao-integral-cozido',
    description: 'Macarrão integral cozido',
    category: 'Cereais e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 168910 (Pasta, whole-wheat, cooked)',
    per100g: { kcal: 149, protein: 5.99, carbs: 30.1, fat: 1.71, fiber: 4.5 },
  },
  {
    // Conferido contra rótulo BR: Piracanjuba Integral ÷2 = 58/3,1/4,7/3,0 por
    // 100 ml, que bate com o USDA. (Rótulo BR é por VOLUME e 100 ml ≈ 103 g, daí
    // ficar ~3% abaixo — é conversão, não divergência de dado.)
    id: 'nm-leite-integral',
    description: 'Leite de vaca integral, líquido',
    category: 'Leite e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 172217 (Milk, whole, 3.25% milkfat), conferido com Piracanjuba UHT',
    per100g: { kcal: 61, protein: 3.15, carbs: 4.78, fat: 3.27 },
  },
  {
    id: 'nm-leite-semidesnatado',
    description: 'Leite de vaca semidesnatado, líquido',
    category: 'Leite e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 172205 (Milk, reduced fat, 2% milkfat)',
    per100g: { kcal: 50, protein: 3.3, carbs: 4.8, fat: 1.98 },
  },
  {
    id: 'nm-leite-desnatado',
    description: 'Leite de vaca desnatado, líquido',
    category: 'Leite e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 173432 (Milk, nonfat/skim)',
    per100g: { kcal: 35, protein: 3.37, carbs: 4.86, fat: 0.18 },
  },
  {
    id: 'nm-tilapia',
    description: 'Tilápia, filé, grelhada/assada',
    category: 'Pescados e frutos do mar',
    source: 'usda-cc0',
    origin: 'USDA FDC 175177 (Fish, tilapia, cooked, dry heat)',
    per100g: { kcal: 128, protein: 26.2, carbs: 0, fat: 2.65 },
  },
  {
    id: 'nm-grao-de-bico-cozido',
    description: 'Grão-de-bico cozido',
    category: 'Leguminosas e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 173757 (Chickpeas, mature seeds, cooked, boiled, without salt)',
    per100g: { kcal: 164, protein: 8.86, carbs: 27.4, fat: 2.59, fiber: 7.6 },
  },

  // ── Modernos e industrializados que a TACO de 2011 não alcançou ──────────
  // Todos do USDA SR Legacy (domínio público). ATENÇÃO ao extrair do FDC: o
  // campo `Energy` aparece DUAS vezes, em kJ e em kcal. Pegar "o último"
  // devolve kJ para vários alimentos (salsicha 1350, sorvete 868, pizza 1120) —
  // valores que, embarcados, triplicariam a energia do registro. Onde o número
  // abaixo veio de kJ, a conversão (÷ 4,184) está anotada e confere com Atwater.
  {
    id: 'nm-granola',
    description: 'Granola tradicional',
    category: 'Cereais e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 171646 (Cereals ready-to-eat, granola, homemade)',
    per100g: { kcal: 489, protein: 13.7, carbs: 53.9, fat: 24.3, fiber: 8.9 },
  },
  {
    id: 'nm-quinoa-cozida',
    description: 'Quinoa cozida',
    category: 'Cereais e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 168917 (Quinoa, cooked)',
    per100g: { kcal: 120, protein: 4.4, carbs: 21.3, fat: 1.92, fiber: 2.8 },
  },
  {
    id: 'nm-chia',
    description: 'Chia, semente seca',
    category: 'Nozes e sementes',
    source: 'usda-cc0',
    origin: 'USDA FDC 170554 (Seeds, chia seeds, dried)',
    per100g: { kcal: 486, protein: 16.5, carbs: 42.1, fat: 30.7, fiber: 34.4 },
  },
  {
    id: 'nm-salsicha',
    description: 'Salsicha (tipo hot dog)',
    category: 'Carnes e derivados',
    source: 'usda-cc0',
    origin: 'USDA FDC 174614 (Frankfurter, beef, heated) — 1350 kJ ÷ 4,184 = 323 kcal',
    per100g: { kcal: 323, protein: 11.7, carbs: 2.66, fat: 29.4 },
  },
  {
    id: 'nm-sorvete',
    description: 'Sorvete de creme',
    category: 'Produtos açucarados',
    source: 'usda-cc0',
    origin: 'USDA FDC 167575 (Ice creams, vanilla) — 868 kJ ÷ 4,184 = 207 kcal',
    per100g: { kcal: 207, protein: 3.5, carbs: 23.6, fat: 11, fiber: 0.7 },
  },
  {
    id: 'nm-pizza-mussarela',
    description: 'Pizza de mussarela, assada',
    category: 'Alimentos preparados',
    source: 'usda-cc0',
    origin: 'USDA FDC 170317 (Pizza, cheese topping, regular crust) — 1120 kJ ÷ 4,184 = 268 kcal',
    per100g: { kcal: 268, protein: 10.4, carbs: 29, fat: 12.3, fiber: 2.2 },
  },
  {
    id: 'nm-panqueca',
    description: 'Panqueca simples (massa, sem recheio)',
    category: 'Alimentos preparados',
    source: 'usda-cc0',
    origin: 'USDA FDC 175009 (Pancakes, plain, prepared from recipe)',
    per100g: { kcal: 227, protein: 6.4, carbs: 28.3, fat: 9.7 },
  },
  {
    // ÁLCOOL tem 7 kcal/g e NÃO aparece em proteína/carbo/gordura: sem o campo
    // `alcohol`, a checagem de Atwater acusaria 85 kcal contra 11 "esperadas" e
    // reprovaria um dado correto. É também o motivo de o vinho ser fácil de
    // esquecer numa dieta — a energia não está em nenhum macro.
    id: 'nm-vinho-tinto',
    description: 'Vinho tinto de mesa',
    category: 'Bebidas (alcoólicas e não alcoólicas)',
    source: 'usda-cc0',
    origin: 'USDA FDC 173190 (Alcoholic beverage, wine, table, red)',
    per100g: { kcal: 85, protein: 0.07, carbs: 2.61, fat: 0, alcohol: 10.6 },
  },

  // ── Iogurte grego: DOIS alimentos sob o mesmo nome ───────────────────────
  // Não existe padrão de identidade legal para "iogurte grego" no Brasil (a IN
  // 46/2007 do MAPA regula leite fermentado genericamente). Por isso o rótulo
  // pode chamar de grego uma SOBREMESA espessada com amido e gelatina, sem
  // coagem. Juntar os dois num item só erraria a proteína em ~2× e o
  // carboidrato em ~3× — na direção que mais importa para quem faz dieta.
  {
    // Nestlé 150/5,6/15,6/7,3 · Danone 146/5,0/15,0/7,3 · Vigor 154/5,6/15,6/7,8.
    // O número que define a categoria: ~11 g de açúcar ADICIONADO por 100 g
    // contra ~5 g de proteína. Tem proteína igual ou MENOR que iogurte natural.
    id: 'nm-iogurte-grego-sobremesa',
    description: 'Iogurte grego tradicional (sobremesa láctea)',
    category: 'Leite e derivados',
    source: 'rotulo-anvisa',
    origin: 'Nestlé, Danone e Vigor Grego Tradicional (rótulos)',
    per100g: { kcal: 148, protein: 5.3, carbs: 15.5, fat: 7.4 },
  },
  {
    // YoPRO 58/11,0/3,2/0,1 · Yorgus 58/11,5/3,0/0. Coado de verdade, sem
    // açúcar adicionado. É o que a literatura internacional chama de "Greek".
    id: 'nm-iogurte-grego-proteico',
    description: 'Iogurte grego coado / proteico (sem açúcar adicionado)',
    category: 'Leite e derivados',
    source: 'rotulo-anvisa',
    origin: 'YoPRO Natural (Danone) e Yorgus Natural (rótulos)',
    per100g: { kcal: 60, protein: 10.5, carbs: 3.5, fat: 0.3 },
  },
];

/**
 * Alimentos que NÃO recebem valor genérico, e o porquê. Não é lacuna a
 * preencher: é a resposta honesta quando a variação real torna qualquer número
 * único enganoso. O consumidor usa isto para pedir a informação que falta em vez
 * de registrar um chute com cara de medida.
 */
export const AMBIGUOUS_FOODS: Readonly<Record<string, string>> = {
  'barra de proteina':
    'a faixa real é 294–504 kcal e 20–42 g de proteína por 100 g, e varia dentro da MESMA ' +
    'marca só trocando o sabor. Me diga a marca, o sabor e o peso da barra.',
  'pasta de amendoim com whey':
    'pasta com whey e cobertura é outro alimento (o carboidrato chega a triplicar frente à ' +
    'pasta 100% amendoim). Me diga a marca e o sabor.',
};

const BY_ID = new Map(EXTRA_FOODS.map((f) => [f.id, f]));

export function getExtraFood(id: string): ExtraFood | null {
  return BY_ID.get(id) ?? null;
}
