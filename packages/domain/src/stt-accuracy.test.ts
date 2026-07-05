import { describe, expect, it } from 'vitest';
import { clinicalTermRecall, scoreTranscript, wordErrorRate } from './stt-accuracy';

const VOCAB = ['precordial', 'palpitação', 'semaglutida', 'dor torácica'];

describe('clinicalTermRecall', () => {
  it('conta só os termos presentes na REFERÊNCIA e mede se o STT os capturou', () => {
    const ref = 'Paciente com dor precordial e palpitação; iniciada semaglutida.';
    // o STT corrompeu precordial→primordial e palpitação→próvercoação (caso real)
    const hyp = 'Paciente com dor primordial e próvercoação; iniciada semaglutida.';
    const r = clinicalTermRecall(ref, hyp, VOCAB);
    expect(r.expected).toBe(3); // precordial, palpitação, semaglutida (não "dor torácica")
    expect(r.found).toBe(1); // só semaglutida sobreviveu
    expect(r.missed).toEqual(expect.arrayContaining(['precordial', 'palpitação']));
    expect(r.recall).toBeCloseTo(1 / 3, 5);
  });

  it('recall perfeito quando todos os termos esperados sobrevivem; casa multi-palavra', () => {
    const r = clinicalTermRecall('Refere dor torácica aos esforços.', 'refere dor toracica aos esforcos', VOCAB);
    expect(r.expected).toBe(1);
    expect(r.recall).toBe(1);
  });

  it('sem termo clínico na referência ⇒ recall 1 (nada a perder)', () => {
    expect(clinicalTermRecall('bom dia, tudo bem?', 'bom dia tudo bem', VOCAB).recall).toBe(1);
  });
});

describe('wordErrorRate', () => {
  it('0 quando idêntico (ignorando acento/pontuação/caixa)', () => {
    expect(wordErrorRate('Dor precordial, aos esforços.', 'dor precordial aos esforcos')).toBe(0);
  });

  it('uma substituição em cinco palavras ⇒ 0,2', () => {
    expect(wordErrorRate('a b c d e', 'a b X d e')).toBeCloseTo(0.2, 5);
  });

  it('referência vazia ⇒ 0 se hipótese vazia, senão 1', () => {
    expect(wordErrorRate('', '')).toBe(0);
    expect(wordErrorRate('', 'algo')).toBe(1);
  });
});

describe('scoreTranscript', () => {
  it('combina recall clínico + WER num escore por configuração', () => {
    const s = scoreTranscript('dor precordial', 'dor primordial', VOCAB);
    expect(s.termRecall.recall).toBe(0); // precordial perdido
    expect(s.wer).toBeCloseTo(0.5, 5); // 1 de 2 palavras errada
  });
});
