import { describe, it, expect } from 'vitest';
import { checkRanges } from './measurement-ranges';

describe('checkRanges (validação de faixa)', () => {
  it('valores plausíveis passam (null)', () => {
    expect(checkRanges({ peso: 90, imc: 28.8, ldl: 161, hba1c: 5.7 })).toBeNull();
  });

  it('peso absurdo (900 kg) é barrado com mensagem clara', () => {
    const msg = checkRanges({ peso: 900 });
    expect(msg).toContain('Peso');
    expect(msg).toContain('900');
    expect(msg).toContain('20–400');
    expect(msg).toContain('nada foi salvo');
  });

  it('barra abaixo do mínimo e negativos', () => {
    expect(checkRanges({ peso: 5 })).not.toBeNull();
    expect(checkRanges({ cintura: -10 })).not.toBeNull();
  });

  it('campos undefined são ignorados', () => {
    expect(checkRanges({ peso: 90, massaMuscular: undefined })).toBeNull();
  });

  it('campo sem faixa conhecida é ignorado', () => {
    expect(checkRanges({ qualquerCoisa: 999999 })).toBeNull();
  });

  it('exame personalizado tem sanidade generosa mas barra o absurdo', () => {
    expect(checkRanges({ custom1: 2.5 })).toBeNull();
    expect(checkRanges({ custom1: 9_000_000 })).not.toBeNull();
  });

  it('metas nutricionais: kcal fora da faixa é barrada', () => {
    expect(checkRanges({ kcal: 2200, protein: 150 })).toBeNull();
    expect(checkRanges({ kcal: 99_999 })).not.toBeNull();
  });

  it('retorna o PRIMEIRO campo ofensor', () => {
    const msg = checkRanges({ peso: 90, imc: 500 });
    expect(msg).toContain('IMC');
  });
});
