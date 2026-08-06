import { describe, expect, it } from 'vitest';
import { searchFood, TACO_MATCH_THRESHOLD } from './search';

/**
 * Testes da BUSCA LEXICAL isolada — sem o catálogo curado do
 * `@nutrimed/food-catalog`. Existem porque a busca é o fallback para tudo que a
 * curadoria não cobre (a cauda longa), e porque sem eles não haveria como saber
 * se as correções de score valeram alguma coisa: o catálogo passa na frente e
 * esconderia qualquer regressão aqui.
 *
 * Os casos abaixo foram medidos ERRADOS em produção (2026-08-06) e são
 * corrigíveis lexicalmente. O caso "frango grelhado" → coração NÃO está aqui de
 * propósito: ele não é corrigível por score (o coração é, lexicalmente, o match
 * melhor) e é justamente o que justifica o catálogo existir.
 */

function top(query: string): string {
  const [m] = searchFood(query, 1);
  return m?.food.description ?? '(nada)';
}

describe('bônus de token de cabeça', () => {
  it('"aveia" é o cereal, não o pão que contém aveia', () => {
    expect(top('aveia')).toMatch(/^Aveia/);
  });

  it('"carne moida" é a carne moída, não o estrogonofe', () => {
    expect(top('carne moida')).toMatch(/^Carne/);
    expect(top('carne moida')).not.toMatch(/Estrogonofe/);
  });

  it('"morango" é a fruta, não o biscoito recheado', () => {
    expect(top('morango')).toMatch(/^Morango/);
  });

  it('"arroz" não cai em bolinho de arroz', () => {
    expect(top('arroz')).not.toMatch(/Bolinho/);
  });

  it('"laranja" não cai em refrigerante de laranja', () => {
    expect(top('laranja')).not.toMatch(/Refrigerante/);
  });

  it('não inventa match: consulta sem relação continua sem resultado', () => {
    expect(searchFood('zzzz qqqq')).toEqual([]);
  });
});

describe('penalidade de "cru" restrita a cereais e leguminosas', () => {
  it('feijão sem qualificador continua indo para o cozido (o motivo da regra)', () => {
    // Feijão cru tem 329 kcal/100 g contra 76 do cozido — o erro que a
    // penalidade foi criada para evitar. Ela precisa continuar valendo aqui.
    expect(top('feijao')).toMatch(/cozido/);
  });

  it('arroz sem qualificador continua indo para o cozido', () => {
    expect(top('arroz branco')).not.toMatch(/\bcru\b/);
  });

  it('fruta crua deixou de ser esmagada pela penalidade forte', () => {
    // Antes, "Banana, prata, crua" levava ×0.6 e despencava para 0,5 — ficava
    // fora de qualquer disputa. Agora leva só o empurrãozinho e disputa de
    // igual para igual.
    //
    // ATENÇÃO: isto NÃO afirma que "banana" resolve para a fruta. Não resolve, e
    // não tem como: para a consulta "banana", "Banana, doce em barra" e
    // "Banana, prata, crua" são lexicalmente indistinguíveis (mesmo token de
    // cabeça, mesmo número de tokens, mesma cobertura). É o mesmo beco sem saída
    // de "frango grelhado" × coração de galinha — e é por isso que existe o
    // catálogo curado, que resolve os dois. Ver o corpus em @nutrimed/food-catalog.
    const todas = searchFood('banana', 8);
    const primeiro = todas[0]!;
    const prata = todas.find((m) => /prata, crua/.test(m.food.description))!;

    expect(prata, 'a banana fresca sumiu do resultado').toBeDefined();
    // Com o ×0.6 antigo ela caía para ~0,5 contra 0,983 (razão 0,51). Agora
    // fica a 2% do topo — perde só o desempate, não a disputa.
    expect(prata.score / primeiro.score).toBeGreaterThan(0.9);
  });

  it('quem pede explicitamente cru continua recebendo cru', () => {
    expect(top('feijao carioca cru')).toMatch(/cru/);
  });
});

describe('limiar de confiança', () => {
  it('subiu de 0,5 para 0,6', () => {
    // Um item que casou metade dos termos não é certeza. Com o limiar em 0,5 e
    // comparação `>=`, "arroz branco" × "Arroz carreteiro" pontuava exatamente
    // 0,5 e era registrado sem nenhuma sinalização ao paciente.
    expect(TACO_MATCH_THRESHOLD).toBe(0.6);
  });

  it('match bom passa folgado do limiar', () => {
    for (const q of ['banana prata', 'ovo cozido', 'batata doce cozida', 'iogurte natural']) {
      const [m] = searchFood(q, 1);
      expect(m!.score, `"${q}" ficou abaixo do limiar`).toBeGreaterThanOrEqual(TACO_MATCH_THRESHOLD);
    }
  });

  it('score nunca passa de 1 (o bônus de cabeça não estoura a escala)', () => {
    for (const q of ['banana', 'arroz', 'morango', 'aveia', 'feijao', 'ovo']) {
      for (const m of searchFood(q, 5)) expect(m.score).toBeLessThanOrEqual(1);
    }
  });
});
