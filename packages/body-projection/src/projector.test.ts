import { describe, it, expect, vi } from 'vitest';
import {
  validateProjectionInput,
  base64Bytes,
  bmiFrom,
  sniffImageMime,
  BodyProjectorError,
  type BodyProjectionInput,
} from './projector';
import { FakeBodyProjector } from './fake-projector';
import { GeminiBodyProjector, buildPrompt } from './gemini-projector';
import { OpenAiBodyProjector } from './openai-projector';
import { createBodyProjector } from './index';

const FOTO = Buffer.from('foto-fake-do-paciente').toString('base64');

const BASE: BodyProjectionInput = {
  photoBase64: FOTO,
  mimeType: 'image/jpeg',
  currentWeightKg: 96,
  targetWeightKg: 78,
  heightCm: 175,
};

/** Resposta do Gemini no formato REST (parts com inlineData). */
function respostaOk(imagem = 'AAAA', mimeType = 'image/png') {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType, data: imagem } }] } }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 1290 },
    }),
  } as unknown as Response;
}

describe('validateProjectionInput — fronteira de entrada', () => {
  it('aceita uma entrada plausível', () => {
    expect(validateProjectionInput(BASE)).toBeNull();
  });

  it('rejeita foto ausente e formato não suportado', () => {
    expect(validateProjectionInput({ ...BASE, photoBase64: '' })).toMatch(/Selecione uma foto/);
    expect(
      validateProjectionInput({ ...BASE, mimeType: 'image/gif' as never }),
    ).toMatch(/não suportado/);
  });

  it('rejeita pesos fora da faixa plausível e não numéricos', () => {
    expect(validateProjectionInput({ ...BASE, targetWeightKg: 5 })).toMatch(/fora da faixa/);
    expect(validateProjectionInput({ ...BASE, currentWeightKg: 900 })).toMatch(/fora da faixa/);
    expect(validateProjectionInput({ ...BASE, currentWeightKg: Number.NaN })).toMatch(/peso atual/);
  });

  it('exige peso desejado diferente do atual (senão não há o que projetar)', () => {
    expect(validateProjectionInput({ ...BASE, targetWeightKg: 96.2 })).toMatch(/diferente/);
  });

  it('rejeita altura implausível, mas altura ausente é válida', () => {
    expect(validateProjectionInput({ ...BASE, heightCm: 30 })).toMatch(/Altura/);
    const { heightCm: _omitida, ...semAltura } = BASE;
    expect(validateProjectionInput(semAltura)).toBeNull();
  });

  it('rejeita imagem acima do teto pós-downscale', () => {
    const gigante = 'A'.repeat(6 * 1024 * 1024);
    expect(validateProjectionInput({ ...BASE, photoBase64: gigante })).toMatch(/muito grande/);
  });
});

describe('helpers', () => {
  it('base64Bytes estima o tamanho decodificado, com e sem padding', () => {
    for (const texto of ['a', 'ab', 'abc', 'abcd', 'foto-do-paciente']) {
      const b64 = Buffer.from(texto).toString('base64');
      expect(base64Bytes(b64)).toBe(Buffer.byteLength(texto));
    }
    expect(base64Bytes('')).toBe(0);
  });

  it('bmiFrom calcula IMC a partir de peso e altura em cm', () => {
    expect(bmiFrom(96, 175)).toBeCloseTo(31.35, 2);
    expect(bmiFrom(78, 175)).toBeCloseTo(25.47, 2);
  });
});

describe('sniffImageMime — formato pelos bytes, não pelo que o cliente diz', () => {
  it('reconhece JPEG, PNG e WebP pelos magic bytes', () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe(
      'image/png',
    );
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    expect(sniffImageMime(webp)).toBe('image/webp');
  });

  it('rejeita outros formatos e arquivos truncados', () => {
    expect(sniffImageMime(Buffer.from('%PDF-1.7', 'ascii'))).toBeNull();
    expect(sniffImageMime(Buffer.from([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // GIF
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });

  it('não confia no RIFF sozinho (WAV também começa com RIFF)', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(sniffImageMime(wav)).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('ancora no ESTADO FINAL: IMC de destino e sua categoria OMS', () => {
    const p = buildPrompt(BASE);
    expect(p).toContain('BMI is 31.3 — obesity class I');
    expect(p).toContain('Redraw them at 78.0 kg, BMI 25.5 — overweight');
    expect(p).toContain('19% of their body mass'); // 18/96
  });

  it('proíbe copiar as proporções atuais — o bug era devolver o mesmo corpo', () => {
    expect(buildPrompt(BASE)).toContain('Do not copy the current body proportions');
  });

  it('nomeia a categoria de IMC em cada faixa da OMS', () => {
    const cat = (cur: number, tgt: number) =>
      buildPrompt({ ...BASE, currentWeightKg: cur, targetWeightKg: tgt, heightCm: 170 });
    expect(cat(120, 100)).toContain('obesity class III'); // 41.5
    expect(cat(110, 100)).toContain('obesity class II'); // 38.1
    expect(cat(95, 85)).toContain('obesity class I'); // 32.9
    expect(cat(80, 70)).toContain('overweight'); // 27.7
    expect(cat(70, 60)).toContain('a normal, healthy weight'); // 24.2
    expect(cat(60, 52)).toContain('underweight'); // 18.0 no destino
  });

  it('descreve a anatomia concreta em vez de "distribuição de gordura"', () => {
    const p = buildPrompt(BASE);
    expect(p).toContain('waist and abdomen are visibly narrower');
    expect(p).toContain('jawline and chin clearly more defined');
  });

  it('manda a roupa VESTIR o novo corpo (ela é que desenha a silhueta)', () => {
    expect(buildPrompt(BASE)).toContain('hanging more loosely');
    expect(buildPrompt({ ...BASE, currentWeightKg: 52, targetWeightKg: 60 })).toContain('tighter across the body');
  });

  it('inverte a anatomia quando a meta é ganhar peso', () => {
    const p = buildPrompt({ ...BASE, currentWeightKg: 52, targetWeightKg: 60 });
    expect(p).toContain('Redraw them at 60.0 kg');
    expect(p).toContain('abdomen are fuller and rounder');
    expect(p).not.toContain('narrower');
  });

  it('escala a frase de magnitude pela % da massa corporal', () => {
    const em = (cur: number, tgt: number) => buildPrompt({ ...BASE, currentWeightKg: cur, targetWeightKg: tgt });
    expect(em(100, 78)).toContain('dramatic, unmistakable transformation'); // 22%
    expect(em(100, 88)).toContain('substantial, clearly visible change'); // 12%
    expect(em(100, 93)).toContain('clearly noticeable change'); // 7%
    expect(em(100, 97)).toContain('modest but still perceptible change'); // 3%
  });

  it('preserva a identidade e omite o IMC sem altura', () => {
    const { heightCm: _omitida, ...semAltura } = BASE;
    const p = buildPrompt(semAltura);
    expect(p).not.toContain('BMI');
    expect(p).toContain('same face and identity');
  });
});

describe('FakeBodyProjector', () => {
  it('devolve a própria foto, marcada como fake', async () => {
    const r = await new FakeBodyProjector().project(BASE);
    expect(r.imageBase64).toBe(FOTO);
    expect(r.modelVersion).toBe('fake-projector');
  });

  it('valida a entrada como o real (erro kind=input)', async () => {
    await expect(new FakeBodyProjector().project({ ...BASE, targetWeightKg: 0 })).rejects.toMatchObject({
      kind: 'input',
    });
  });
});

describe('GeminiBodyProjector', () => {
  it('envia a foto como inlineData e a key no header, e devolve a imagem gerada', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaOk('IMAGEM-GERADA', 'image/png'));
    const onUsage = vi.fn();
    const r = await new GeminiBodyProjector({ apiKey: 'k-123', fetchImpl, onUsage }).project(BASE);

    expect(r).toEqual({
      imageBase64: 'IMAGEM-GERADA',
      mimeType: 'image/png',
      modelVersion: 'gemini-2.5-flash-image',
    });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 800, outputTokens: 1290 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('gemini-2.5-flash-image:generateContent');
    expect(url).not.toContain('k-123'); // key nunca na URL (vaza em log)
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k-123');
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: FOTO });
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
  });

  it('recusa por política vira kind=safety (200 com finishReason)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }),
    } as unknown as Response);
    await expect(new GeminiBodyProjector({ apiKey: 'k', fetchImpl }).project(BASE)).rejects.toMatchObject(
      { kind: 'safety' },
    );
  });

  it('bloqueio no prompt também vira kind=safety', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    } as unknown as Response);
    await expect(new GeminiBodyProjector({ apiKey: 'k', fetchImpl }).project(BASE)).rejects.toMatchObject(
      { kind: 'safety' },
    );
  });

  it('erro HTTP vira kind=api', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'quota' } }),
    } as unknown as Response);
    await expect(new GeminiBodyProjector({ apiKey: 'k', fetchImpl }).project(BASE)).rejects.toMatchObject(
      { kind: 'api' },
    );
  });

  it('resposta sem imagem vira kind=parse', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'não posso' }] } }] }),
    } as unknown as Response);
    await expect(new GeminiBodyProjector({ apiKey: 'k', fetchImpl }).project(BASE)).rejects.toMatchObject(
      { kind: 'parse' },
    );
  });

  it('não chama a API quando a entrada é inválida', async () => {
    const fetchImpl = vi.fn();
    await expect(
      new GeminiBodyProjector({ apiKey: 'k', fetchImpl }).project({ ...BASE, photoBase64: '' }),
    ).rejects.toBeInstanceOf(BodyProjectorError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exige credencial na construção', () => {
    expect(() => new GeminiBodyProjector({ apiKey: '' })).toThrow(BodyProjectorError);
  });
});

describe('OpenAiBodyProjector', () => {
  function respostaOk(imagem = 'IMG-OPENAI') {
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: imagem }], usage: { input_tokens: 900, output_tokens: 1500 } }),
    } as unknown as Response;
  }

  it('envia multipart com a foto e o prompt, no gpt-image-2 por default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaOk());
    const onUsage = vi.fn();
    const r = await new OpenAiBodyProjector({ apiKey: 'sk-1', fetchImpl, onUsage }).project(BASE);

    expect(r).toEqual({ imageBase64: 'IMG-OPENAI', mimeType: 'image/png', modelVersion: 'gpt-image-2' });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 1500 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('/v1/images/edits');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.get('image')).toBeInstanceOf(Blob);
    // Mesmo prompt do Gemini — no comparativo o modelo é a única variável.
    expect(form.get('prompt')).toBe(buildPrompt(BASE));
    // content-type é do fetch (precisa do boundary) — defini-lo à mão quebraria.
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('input_fidelity só vai para a família gpt-image-1 (o 2 responde 400)', async () => {
    const chamar = async (model?: string) => {
      const fetchImpl = vi.fn().mockResolvedValue(respostaOk());
      await new OpenAiBodyProjector({ apiKey: 'k', fetchImpl, ...(model ? { model } : {}) }).project(BASE);
      return fetchImpl.mock.calls[0]![1].body as FormData;
    };

    expect((await chamar()).get('input_fidelity')).toBeNull(); // gpt-image-2
    expect((await chamar('gpt-image-2')).get('input_fidelity')).toBeNull();
    expect((await chamar('gpt-image-1')).get('input_fidelity')).toBe('high');
    expect((await chamar('gpt-image-1-mini')).get('input_fidelity')).toBe('high');
  });

  it('403 vira kind=config (organização não verificada), não "tente outra foto"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'must be verified' } }),
    } as unknown as Response);
    await expect(new OpenAiBodyProjector({ apiKey: 'k', fetchImpl }).project(BASE)).rejects.toMatchObject({
      kind: 'config',
    });
  });

  it('moderation_blocked vira kind=safety', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 'moderation_blocked' } }),
    } as unknown as Response);
    await expect(new OpenAiBodyProjector({ apiKey: 'k', fetchImpl }).project(BASE)).rejects.toMatchObject({
      kind: 'safety',
    });
  });

  it('resposta sem imagem vira kind=parse e entrada inválida não chama a API', async () => {
    const semImagem = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as unknown as Response);
    await expect(new OpenAiBodyProjector({ apiKey: 'k', fetchImpl: semImagem }).project(BASE)).rejects.toMatchObject({
      kind: 'parse',
    });

    const nunca = vi.fn();
    await expect(
      new OpenAiBodyProjector({ apiKey: 'k', fetchImpl: nunca }).project({ ...BASE, photoBase64: '' }),
    ).rejects.toBeInstanceOf(BodyProjectorError);
    expect(nunca).not.toHaveBeenCalled();
  });
});

describe('createBodyProjector — seleção por ambiente', () => {
  it('BODY_PROJECTOR=fake força o fake mesmo com key presente', () => {
    const p = createBodyProjector({ BODY_PROJECTOR: 'fake', GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(FakeBodyProjector);
  });

  it('key presente ⇒ Gemini (default histórico, inalterado)', () => {
    const p = createBodyProjector({ GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(GeminiBodyProjector);
  });

  it('BODY_PROJECTOR=openai escolhe a OpenAI; sem a key ⇒ null', () => {
    expect(
      createBodyProjector({ BODY_PROJECTOR: 'openai', OPENAI_API_KEY: 'sk' } as NodeJS.ProcessEnv),
    ).toBeInstanceOf(OpenAiBodyProjector);
    expect(createBodyProjector({ BODY_PROJECTOR: 'openai' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('OPENAI_API_KEY sozinha NÃO troca o provedor (a var já é do STT)', () => {
    const p = createBodyProjector({ OPENAI_API_KEY: 'sk', GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(GeminiBodyProjector);
    expect(createBodyProjector({ OPENAI_API_KEY: 'sk', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('sem key fora de produção ⇒ fake; em produção ⇒ null (UI esconde o recurso)', () => {
    expect(createBodyProjector({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      FakeBodyProjector,
    );
    expect(createBodyProjector({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
  });
});
