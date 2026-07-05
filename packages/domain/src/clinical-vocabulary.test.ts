import { describe, expect, it } from 'vitest';
import { CLINICAL_VOCABULARY } from './clinical-vocabulary';

describe('CLINICAL_VOCABULARY (boost do STT — T4)', () => {
  it('não tem duplicatas nem termos vazios (cada keyword= paga o próprio custo)', () => {
    const seen = new Set<string>();
    for (const term of CLINICAL_VOCABULARY) {
      expect(term.trim().length).toBeGreaterThan(0);
      const key = term.toLowerCase();
      expect(seen.has(key), `duplicata: ${term}`).toBe(false);
      seen.add(key);
    }
  });

  it('mantém-se curado, não é dump (limite pragmático do keywords= legado do Deepgram)', () => {
    // acima disso, o parâmetro legado degrada — o salto é Nova-3 keyterm (POC 2.5)
    expect(CLINICAL_VOCABULARY.length).toBeLessThanOrEqual(120);
  });

  it('cobre os termos-âncora de confiança (corrupções reais + gatilho + recordatório)', () => {
    for (const term of ['precordial', 'semaglutida', 'TSH', 'proteína', 'bioimpedância']) {
      expect(CLINICAL_VOCABULARY).toContain(term);
    }
  });
});
