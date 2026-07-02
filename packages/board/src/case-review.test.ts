import { describe, it, expect } from 'vitest';
import { parseCaseReview, CASE_REVIEW_SYSTEM } from './case-review';

describe('parseCaseReview (B4 — parse defensivo do roteador)', () => {
  it('skip explícito', () => {
    expect(parseCaseReview('{"skip":true}')).toEqual({ skip: true });
  });

  it('contribuição válida roteada', () => {
    expect(
      parseCaseReview('{"personaId":"yara","type":"hipotese","severity":"normal","text":"Vale checar TSH."}'),
    ).toEqual({ personaId: 'yara', type: 'hipotese', severity: 'normal', text: 'Vale checar TSH.' });
  });

  it('personaId INVENTADO pelo modelo → null (o código valida, não o modelo)', () => {
    expect(parseCaseReview('{"personaId":"dr-house","type":"sugestao","severity":"normal","text":"x"}')).toBeNull();
  });

  it('type/severity inválidos são normalizados; texto vazio → null; JSON quebrado → null', () => {
    expect(parseCaseReview('{"personaId":"paulo","type":"ordem","severity":"urgente","text":"Checar PA."}')).toEqual({
      personaId: 'paulo',
      type: 'sugestao',
      severity: 'normal',
      text: 'Checar PA.',
    });
    expect(parseCaseReview('{"personaId":"paulo","text":""}')).toBeNull();
    expect(parseCaseReview('não é json')).toBeNull();
  });

  it('system prompt: tom de sugestão + preferência por skip (anti-ruído)', () => {
    expect(CASE_REVIEW_SYSTEM).toContain('conduta é sempre do médico');
    expect(CASE_REVIEW_SYSTEM).toContain('PREFIRA skip');
  });
});
