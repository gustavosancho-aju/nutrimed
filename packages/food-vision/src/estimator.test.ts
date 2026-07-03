import { describe, it, expect } from 'vitest';
import { sanitizeFoodEstimate } from './estimator';
import { FakeFoodEstimator } from './fake-estimator';
import { ClaudeFoodEstimator } from './claude-estimator';
import { createFoodEstimator } from './index';

describe('sanitizeFoodEstimate — fronteira de confiança (E12/12.5)', () => {
  it('mantém só nutrientes conhecidos, numéricos e não-negativos', () => {
    const r = sanitizeFoodEstimate({
      values: { kcal: 650, protein: 40, carbs: 70, fat: 20, sodio: 900 },
      confidence: 'high',
    });
    expect(r.values).toEqual({ kcal: 650, protein: 40, carbs: 70, fat: 20 });
    expect(r.confidence).toBe('high');
  });

  it('aceita string com vírgula e valores no nível raiz (sem wrapper values)', () => {
    const r = sanitizeFoodEstimate({ kcal: '620', protein: '41,5', carbs: 60, fat: 15 });
    expect(r.values).toEqual({ kcal: 620, protein: 41.5, carbs: 60, fat: 15 });
  });

  it('confidence inválida ⇒ low; itemsLabel/notes capturados', () => {
    const r = sanitizeFoodEstimate({
      values: { kcal: 500 },
      confidence: 'altíssima',
      itemsLabel: 'arroz, frango',
      notes: 'porção incerta',
    });
    expect(r.confidence).toBe('low');
    expect(r.itemsLabel).toBe('arroz, frango');
    expect(r.notes).toBe('porção incerta');
    // nutrientes ausentes ⇒ 0 (estimativa completa e somável)
    expect(r.values).toEqual({ kcal: 500, protein: 0, carbs: 0, fat: 0 });
  });

  it('ignora não-finitos e negativos (mantém 0)', () => {
    const r = sanitizeFoodEstimate({
      values: { kcal: Number.NaN, protein: Infinity, carbs: -10, fat: 12 },
    });
    expect(r.values).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 12 });
  });

  it('entrada inválida ⇒ estimativa degradada (zeros, confiança baixa; nunca lança)', () => {
    const degraded = { values: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, confidence: 'low' };
    expect(sanitizeFoodEstimate(null)).toEqual(degraded);
    expect(sanitizeFoodEstimate('xxx')).toEqual(degraded);
    expect(sanitizeFoodEstimate({ values: 'nope' })).toEqual(degraded);
  });
});

describe('FakeFoodEstimator', () => {
  it('retorna uma estimativa determinística saneada, aproximada', async () => {
    const fake = new FakeFoodEstimator();
    const r = await fake.estimate({ base64: 'x', mediaType: 'image/jpeg' });
    expect(r.values).toEqual({ kcal: 620, protein: 42, carbs: 68, fat: 18 });
    expect(r.confidence).toBe('medium');
    expect(r.notes).toContain('exemplo');
    expect(fake.modelVersion).toBe('fake-food-estimator');
  });
});

describe('createFoodEstimator — seleção por ambiente (degradação graciosa)', () => {
  it('FOOD_ESTIMATOR=fake força o fake', () => {
    expect(createFoodEstimator({ FOOD_ESTIMATOR: 'fake' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      FakeFoodEstimator,
    );
  });
  it('ANTHROPIC_API_KEY presente ⇒ Claude', () => {
    expect(createFoodEstimator({ ANTHROPIC_API_KEY: 'sk-x' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      ClaudeFoodEstimator,
    );
  });
  it('produção sem key ⇒ null (bot informa indisponibilidade)', () => {
    expect(createFoodEstimator({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('dev sem key ⇒ fake (exercita o fluxo local)', () => {
    expect(createFoodEstimator({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      FakeFoodEstimator,
    );
  });
});
