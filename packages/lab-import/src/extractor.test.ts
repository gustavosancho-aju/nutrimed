import { describe, it, expect } from 'vitest';
import { sanitizeExtraction, sanitizePanel } from './extractor';
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

describe('sanitizePanel — painel completo (E14)', () => {
  it('mantém nome + valor e os campos opcionais reconhecidos', () => {
    const r = sanitizePanel({
      measuredAt: '2026-05-19',
      analytes: [
        { rawName: 'COLESTEROL LDL', value: 108.5, unit: 'mg/dL', referenceText: 'Inferior a 130 mg/dL' },
      ],
    });
    expect(r.measuredAt).toBe('2026-05-19');
    expect(r.analytes).toEqual([
      { rawName: 'COLESTEROL LDL', value: 108.5, unit: 'mg/dL', referenceText: 'Inferior a 130 mg/dL' },
    ]);
  });

  it('NÃO usa whitelist de nomes — exame fora do catálogo sobrevive', () => {
    const r = sanitizePanel({ analytes: [{ rawName: 'Marcador XPTO', value: 3 }] });
    expect(r.analytes).toHaveLength(1);
    expect(r.analytes[0]!.rawName).toBe('Marcador XPTO');
  });

  it('descarta entradas sem nome ou sem valor numérico', () => {
    const r = sanitizePanel({
      analytes: [
        { rawName: 'Ok', value: 1 },
        { rawName: '', value: 2 },
        { rawName: 'Sem valor' },
        { rawName: 'Qualitativo', value: 'positivo' },
        { rawName: 'NaN', value: Number.NaN },
        'lixo',
      ],
    });
    expect(r.analytes.map((a) => a.rawName)).toEqual(['Ok']);
  });

  it('aceita valor em string com vírgula (pt-BR)', () => {
    expect(sanitizePanel({ analytes: [{ rawName: 'HbA1c', value: '4,9' }] }).analytes[0]!.value).toBe(4.9);
  });

  it('deduplica o mesmo exame repetido no laudo (1ª leitura vence)', () => {
    // Neste laudo, SHBG e testosterona aparecem em duas páginas.
    const r = sanitizePanel({
      analytes: [
        { rawName: 'SHBG', value: 12.9 },
        { rawName: 'shbg', value: 99 },
      ],
    });
    expect(r.analytes).toHaveLength(1);
    expect(r.analytes[0]!.value).toBe(12.9);
  });

  it('histórico: só pontos com data ISO e valor numérico', () => {
    const r = sanitizePanel({
      analytes: [
        {
          rawName: 'LDL',
          value: 108,
          history: [
            { measuredAt: '2025-10-22', value: 143.1 },
            { measuredAt: '22/10/2025', value: 143.1 },
            { measuredAt: '2025-03-25' },
            { value: 5 },
          ],
        },
      ],
    });
    expect(r.analytes[0]!.history).toEqual([{ measuredAt: '2025-10-22', value: 143.1 }]);
  });

  it('omite history quando não há ponto válido (não grava array vazio)', () => {
    expect(sanitizePanel({ analytes: [{ rawName: 'LDL', value: 1, history: [] }] }).analytes[0]).toEqual({
      rawName: 'LDL',
      value: 1,
    });
  });

  it('entrada inválida ⇒ painel vazio (nunca lança — NFR13)', () => {
    expect(sanitizePanel(null)).toEqual({ analytes: [] });
    expect(sanitizePanel('xxx')).toEqual({ analytes: [] });
    expect(sanitizePanel({ analytes: 'nope' })).toEqual({ analytes: [] });
  });

  it('data de coleta inválida é ignorada', () => {
    expect(sanitizePanel({ measuredAt: '19/05/2026', analytes: [] }).measuredAt).toBeUndefined();
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
