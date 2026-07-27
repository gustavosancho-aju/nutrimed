import { describe, it, expect } from 'vitest';
import {
  classifyAgainstReference,
  formatRange,
  parseNumber,
  parseReferenceRange,
} from './reference';

describe('parseNumber — pt-BR e en-US', () => {
  it('vírgula é decimal; ponto vira milhar quando há vírgula', () => {
    expect(parseNumber('6,9')).toBe(6.9);
    expect(parseNumber('1.480,5')).toBe(1480.5);
  });
  it('sem vírgula, o ponto é decimal', () => {
    expect(parseNumber('8.6')).toBe(8.6);
    expect(parseNumber('183')).toBe(183);
  });
  it('lixo ⇒ null', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('parseReferenceRange — textos reais do laudo', () => {
  it('intervalo "de X a Y"', () => {
    expect(parseReferenceRange('Masculino: de 3,5 a 8,5 mg/dL')).toEqual({ min: 3.5, max: 8.5 });
    expect(parseReferenceRange('De 239 A 931 pg/mL')).toEqual({ min: 239, max: 931 });
    expect(parseReferenceRange('Homens: De 7,71 a 22,33 micromol/L')).toEqual({ min: 7.71, max: 22.33 });
  });

  it('intervalo com hífen', () => {
    expect(parseReferenceRange('8.6 - 10.3 mg/dL')).toEqual({ min: 8.6, max: 10.3 });
    expect(parseReferenceRange('ADULTOS: 38 - 126 U/L')).toEqual({ min: 38, max: 126 });
  });

  it('intervalo sem preposição', () => {
    expect(parseReferenceRange('137 a 145 mmol/L')).toEqual({ min: 137, max: 145 });
    expect(parseReferenceRange('0,8 a 1,2')).toEqual({ min: 0.8, max: 1.2 });
  });

  it('só teto', () => {
    expect(parseReferenceRange('Menor que 5,7%')).toEqual({ max: 5.7 });
    expect(parseReferenceRange('Masculino : Inferior a 50 U/L')).toEqual({ max: 50 });
    expect(parseReferenceRange('INFERIOR A 2,00 mg/L')).toEqual({ max: 2 });
    expect(parseReferenceRange('Inferior ou Igual A 0,4 mg/dL')).toEqual({ max: 0.4 });
  });

  it('só piso', () => {
    expect(parseReferenceRange('Normal: Acima de 70%')).toEqual({ min: 70 });
    expect(parseReferenceRange('Superior a 90 mL/min/1,73 m2')).toEqual({ min: 90 });
  });

  it('ignora qualificador de IDADE — não confunde "20 anos" com o valor', () => {
    // Sem isso a banda do HDL sairia com piso 20 (a idade) em vez de 40.
    expect(parseReferenceRange('Adultos (Maior que 20 anos): Superior a 40 mg/dL')).toEqual({ min: 40 });
    expect(parseReferenceRange('Adulto maior que 18 anos: Superior a 90 mL/min/1,73 m2')).toEqual({ min: 90 });
    expect(parseReferenceRange('De 21 a 49 ANOS: De 14,6 a 94,6 nmol/L')).toEqual({ min: 14.6, max: 94.6 });
    expect(parseReferenceRange('De 16 A 18 ANOS: De 62-203 U/L')).toEqual({ min: 62, max: 203 });
  });

  it('texto irreconhecível ⇒ faixa vazia (gráfico simplesmente não desenha banda)', () => {
    expect(parseReferenceRange('Ver observação')).toEqual({});
    expect(parseReferenceRange(undefined)).toEqual({});
    expect(parseReferenceRange('')).toEqual({});
  });

  it('intervalo invertido no laudo não vira banda negativa', () => {
    // "de 10 a 2" é leitura incoerente — cai para os limites simples, e como
    // "a 2" casa como teto, o resultado nunca é uma banda de largura negativa.
    const r = parseReferenceRange('de 10 a 2');
    expect(r.min === undefined || r.max === undefined || r.min <= r.max).toBe(true);
  });
});

describe('classifyAgainstReference — leitura literal, sem gradação clínica', () => {
  it('dentro / fora por piso e teto', () => {
    expect(classifyAgainstReference(5, { min: 3, max: 8 })).toBe('dentro');
    expect(classifyAgainstReference(2, { min: 3, max: 8 })).toBe('fora');
    expect(classifyAgainstReference(9, { min: 3, max: 8 })).toBe('fora');
  });
  it('limites são inclusivos', () => {
    expect(classifyAgainstReference(3, { min: 3, max: 8 })).toBe('dentro');
    expect(classifyAgainstReference(8, { min: 3, max: 8 })).toBe('dentro');
  });
  it('faixa aberta usa só o limite que existe', () => {
    expect(classifyAgainstReference(1, { max: 2 })).toBe('dentro');
    expect(classifyAgainstReference(3, { max: 2 })).toBe('fora');
    expect(classifyAgainstReference(95, { min: 90 })).toBe('dentro');
  });
  it('sem faixa ⇒ sem-referencia (nunca inventa juízo)', () => {
    expect(classifyAgainstReference(123, {})).toBe('sem-referencia');
  });
});

describe('formatRange', () => {
  it('formata intervalo, teto e piso em pt-BR', () => {
    expect(formatRange({ min: 3.5, max: 8.5 }, 'mg/dL')).toBe('3,5 – 8,5 mg/dL');
    expect(formatRange({ max: 5.7 }, '%')).toBe('< 5,7 %');
    expect(formatRange({ min: 90 })).toBe('> 90');
    expect(formatRange({})).toBeNull();
  });
});
