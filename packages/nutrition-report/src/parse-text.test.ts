import { describe, expect, it } from 'vitest';
import { parseFoodText } from './parse-text';
import { mapRecallToTaco } from './map';
import { computeNutrition } from './compute';

describe('parseFoodText — registro alimentar por texto do paciente', () => {
  it('gramas explícitos: separa quantidade, unidade e alimento', () => {
    const items = parseFoodText('100g de arroz');
    expect(items).toEqual([{ food: 'arroz', quantity: 100, unit: 'g' }]);
  });

  it('vários itens separados por vírgula e por "e"', () => {
    const items = parseFoodText('100g de arroz, 150g de frango grelhado e 1 colher de azeite');
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ food: 'arroz', quantity: 100, unit: 'g' });
    expect(items[1]).toEqual({ food: 'frango grelhado', quantity: 150, unit: 'g' });
    expect(items[2]).toEqual({ food: 'azeite', quantity: 1, unit: 'colher' });
  });

  it('medida caseira composta ("2 colheres de sopa de feijão")', () => {
    const [item] = parseFoodText('2 colheres de sopa de feijão');
    expect(item).toEqual({ food: 'feijao', quantity: 2, unit: 'colheres de sopa' });
  });

  it('ignora o verbo inicial ("comi", "tomei")', () => {
    expect(parseFoodText('comi 2 ovos')).toEqual([{ food: 'ovos', quantity: 2 }]);
    expect(parseFoodText('tomei 200ml de leite')).toEqual([
      { food: 'leite', quantity: 200, unit: 'ml' },
    ]);
  });

  it('quantidade em palavra ("uma", "meio")', () => {
    expect(parseFoodText('uma banana')).toEqual([{ food: 'banana', quantity: 1 }]);
    expect(parseFoodText('meio mamao')).toEqual([{ food: 'mamao', quantity: 0.5 }]);
  });

  it('quantidade no fim ("frango grelhado 150g")', () => {
    expect(parseFoodText('frango grelhado 150g')).toEqual([
      { food: 'frango grelhado', quantity: 150, unit: 'g' },
    ]);
  });

  it('sem quantidade: OMITE quantity (o mapeamento assume porção e sinaliza)', () => {
    expect(parseFoodText('arroz')).toEqual([{ food: 'arroz' }]);
  });

  it('não confunde alimento que começa com a letra da unidade ("2 gemas")', () => {
    // 'g' não pode casar como unidade dentro de "gemas" — sem \b viraria "emas".
    expect(parseFoodText('2 gemas')).toEqual([{ food: 'gemas', quantity: 2 }]);
  });

  it('litro e copo', () => {
    expect(parseFoodText('1 litro de leite')).toEqual([
      { food: 'leite', quantity: 1, unit: 'litro' },
    ]);
    expect(parseFoodText('2 copos de suco')).toEqual([
      { food: 'suco', quantity: 2, unit: 'copos' },
    ]);
  });

  it('texto sem alimento reconhecível ⇒ lista vazia', () => {
    expect(parseFoodText('')).toEqual([]);
    expect(parseFoodText('   ')).toEqual([]);
    expect(parseFoodText('123')).toEqual([]);
  });

  it('limita a quantidade de itens (proteção de entrada)', () => {
    const items = parseFoodText(Array.from({ length: 60 }, () => 'arroz').join(', '));
    expect(items).toHaveLength(30);
  });

  it('fim a fim: texto → TACO → nutrientes determinísticos, sem porção assumida', () => {
    const computation = computeNutrition(mapRecallToTaco(parseFoodText('100g de arroz')));
    expect(computation.totals.kcal).toBeGreaterThan(0);
    // gramas explícitos ⇒ nada assumido, nada fora da TACO
    expect(computation.estimatedCount).toBe(0);
    expect(computation.unmatched).toHaveLength(0);
  });

  it('fim a fim: sem quantidade ⇒ porção assumida e SINALIZADA', () => {
    const computation = computeNutrition(mapRecallToTaco(parseFoodText('arroz')));
    expect(computation.estimatedCount).toBe(1);
  });
});
