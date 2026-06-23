import { describe, it, expect } from 'vitest';
import { sanitizeExtraction } from './extractor';
import { FakeLabExtractor } from './fake-extractor';
import { createLabExtractor } from './index';

describe('sanitizeExtraction — fronteira de confiança (E11/11.9)', () => {
  it('mantém só campos conhecidos do kind, numéricos', () => {
    const r = sanitizeExtraction(
      { values: { peso: 90, massaGordura: 30, colesterol: 200, imc: 'lixo' } },
      'body',
    );
    expect(r.values).toEqual({ peso: 90, massaGordura: 30 });
    expect(r.kind).toBe('body');
  });

  it('descarta campos de outro kind', () => {
    const r = sanitizeExtraction({ values: { ldl: 130, peso: 80 } }, 'lab');
    expect(r.values).toEqual({ ldl: 130 }); // peso é de body, não entra em lab
  });

  it('aceita valores no nível raiz (sem wrapper values) e string com vírgula', () => {
    const r = sanitizeExtraction({ hba1c: '5,9', insulina: 14 }, 'lab');
    expect(r.values).toEqual({ hba1c: 5.9, insulina: 14 });
  });

  it('captura measuredAt ISO válido e ignora data inválida', () => {
    expect(sanitizeExtraction({ measuredAt: '2026-03-10', values: {} }, 'lab').measuredAt).toBe('2026-03-10');
    expect(sanitizeExtraction({ measuredAt: '10/03/2026', values: {} }, 'lab').measuredAt).toBeUndefined();
  });

  it('entrada inválida ⇒ rascunho vazio (nunca lança — degradação graciosa)', () => {
    expect(sanitizeExtraction(null, 'body')).toEqual({ kind: 'body', values: {} });
    expect(sanitizeExtraction('xxx', 'lab')).toEqual({ kind: 'lab', values: {} });
    expect(sanitizeExtraction({ values: 'nope' }, 'body').values).toEqual({});
  });

  it('ignora valores não-finitos (NaN/Infinity)', () => {
    const r = sanitizeExtraction({ values: { peso: Number.NaN, imc: Infinity, cintura: 95 } }, 'body');
    expect(r.values).toEqual({ cintura: 95 });
  });
});

describe('FakeLabExtractor', () => {
  it('retorna um rascunho determinístico saneado, com nota de exemplo', async () => {
    const fake = new FakeLabExtractor();
    const r = await fake.extract({ base64: 'x' }, 'body');
    expect(r.values.peso).toBe(84.2);
    expect(Object.keys(r.values)).toEqual(['peso', 'massaMuscular', 'massaGordura', 'cintura', 'imc', 'pgc']);
    expect(r.notes).toContain('exemplo');
  });
});

describe('createLabExtractor — seleção por ambiente (ADR-012/NFR13)', () => {
  it('LAB_EXTRACTOR=fake força o fake', () => {
    expect(createLabExtractor({ LAB_EXTRACTOR: 'fake' } as NodeJS.ProcessEnv)).toBeInstanceOf(FakeLabExtractor);
  });
  it('produção sem key ⇒ null (cai p/ manual)', () => {
    expect(createLabExtractor({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
  });
  it('dev sem key ⇒ fake (exercita o fluxo local)', () => {
    expect(createLabExtractor({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeInstanceOf(FakeLabExtractor);
  });
});
