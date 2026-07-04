import { describe, expect, it } from 'vitest';
import {
  TACO_MATCH_THRESHOLD,
  TACO_VERSION,
  defaultPortionGrams,
  getFood,
  gramsForQuantity,
  listFoods,
  searchFood,
} from './index';

describe('dataset TACO', () => {
  it('embarca a TACO 4ª ed. com ~590 alimentos íntegros', () => {
    const foods = listFoods();
    expect(TACO_VERSION).toBe('taco-4ed');
    expect(foods.length).toBeGreaterThanOrEqual(580);
    for (const food of foods) {
      expect(food.id).toBeTruthy();
      expect(food.description.length).toBeGreaterThan(2);
      // kcal ou proteína presentes e não-negativos (gen-taco descarta o resto)
      const kcal = food.per100g.kcal;
      const protein = food.per100g.protein;
      expect(kcal !== undefined || protein !== undefined).toBe(true);
      for (const value of Object.values(food.per100g)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('confere valores por amostragem contra a TACO oficial (arroz integral cozido)', () => {
    const [match] = searchFood('arroz integral cozido', 1);
    expect(match).toBeDefined();
    expect(match!.food.description).toBe('Arroz, integral, cozido');
    // TACO 4ª ed.: 124 kcal, 2,6 g proteína, 25,8 g carboidrato por 100 g
    expect(match!.food.per100g.kcal).toBeCloseTo(123.53, 1);
    expect(match!.food.per100g.protein).toBeCloseTo(2.59, 1);
    expect(match!.food.per100g.carbs).toBeCloseTo(25.81, 1);
  });
});

describe('searchFood', () => {
  it('casa variações com acento e plural ("feijões" → feijão)', () => {
    const matches = searchFood('feijões carioca cozido');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.food.description.toLowerCase()).toContain('feijão');
    expect(matches[0]!.score).toBeGreaterThanOrEqual(TACO_MATCH_THRESHOLD);
  });

  it('prefere o item mais específico quando a consulta detalha o preparo', () => {
    const [match] = searchFood('frango peito grelhado', 1);
    expect(match!.food.description.toLowerCase()).toContain('frango');
    expect(match!.food.description.toLowerCase()).toContain('grelhado');
  });

  it('prefere a variante COZIDA quando o paciente não disse "cru" (recordatório = comido)', () => {
    const [feijao] = searchFood('feijão carioca', 1);
    expect(feijao!.food.description).toContain('cozido');
    // pedindo cru explicitamente, a variante crua vence
    const [cru] = searchFood('feijão carioca cru', 1);
    expect(cru!.food.description).toContain('cru');
  });

  it('expande sinônimos coloquiais ("bife grelhado" → carne bovina, não peixe)', () => {
    const [bife] = searchFood('bife grelhado', 1);
    expect(bife!.food.description.toLowerCase()).toContain('bovina');
    expect(bife!.food.description.toLowerCase()).toContain('grelhad');
  });

  it('retorna vazio para consulta sem termos úteis e score baixo para termo inexistente', () => {
    expect(searchFood('de a o')).toEqual([]);
    const noMatch = searchFood('xyzabc123');
    expect(noMatch).toEqual([]);
  });

  it('getFood resolve por id e retorna null para id desconhecido', () => {
    const [match] = searchFood('arroz integral cozido', 1);
    expect(getFood(match!.food.id)?.description).toBe(match!.food.description);
    expect(getFood('id-inexistente')).toBeNull();
  });
});

describe('porções', () => {
  it('porção padrão por palavra-chave e por categoria', () => {
    const [pao] = searchFood('pão francês', 1);
    expect(defaultPortionGrams(pao!.food).grams).toBe(50);

    const [feijao] = searchFood('feijão carioca cozido', 1);
    expect(defaultPortionGrams(feijao!.food).grams).toBe(100);

    const [alface] = searchFood('alface crua', 1);
    expect(defaultPortionGrams(alface!.food).grams).toBe(50);
  });

  it('converte unidades caseiras em gramas (tolerando plural)', () => {
    const [arroz] = searchFood('arroz branco cozido', 1);
    expect(gramsForQuantity(arroz!.food, 4, 'colheres de sopa')).toBe(60);
    expect(gramsForQuantity(arroz!.food, 1, 'xícara')).toBe(120);
    expect(gramsForQuantity(arroz!.food, 2, 'copos')).toBe(400);
    expect(gramsForQuantity(arroz!.food, 150, 'g')).toBe(150);
  });

  it('unidades dependentes do alimento usam a porção padrão como peso unitário', () => {
    const [pao] = searchFood('pão francês', 1);
    expect(gramsForQuantity(pao!.food, 2, 'unidades')).toBe(100);
  });

  it('quantidade inválida ou unidade desconhecida → null (consumidor cai na porção padrão)', () => {
    const [arroz] = searchFood('arroz branco cozido', 1);
    expect(gramsForQuantity(arroz!.food, 0, 'copo')).toBeNull();
    expect(gramsForQuantity(arroz!.food, -1, 'copo')).toBeNull();
    expect(gramsForQuantity(arroz!.food, 1, 'jeriva')).toBeNull();
  });
});
