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
  it('descreve a direção, o delta e o IMC de origem/destino', () => {
    const p = buildPrompt(BASE);
    expect(p).toContain('weight loss');
    expect(p).toContain('18.0 kg');
    expect(p).toContain('BMI change from 31.3 to 25.5');
    expect(p).toContain('MUST PRESERVE');
  });

  it('inverte a direção quando a meta é ganhar peso', () => {
    expect(buildPrompt({ ...BASE, currentWeightKg: 52, targetWeightKg: 60 })).toContain('weight gain');
  });

  it('omite o IMC quando a altura é desconhecida', () => {
    const { heightCm: _omitida, ...semAltura } = BASE;
    expect(buildPrompt(semAltura)).not.toContain('BMI');
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

describe('createBodyProjector — seleção por ambiente', () => {
  it('BODY_PROJECTOR=fake força o fake mesmo com key presente', () => {
    const p = createBodyProjector({ BODY_PROJECTOR: 'fake', GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(FakeBodyProjector);
  });

  it('key presente ⇒ Gemini', () => {
    const p = createBodyProjector({ GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(GeminiBodyProjector);
  });

  it('sem key fora de produção ⇒ fake; em produção ⇒ null (UI esconde o recurso)', () => {
    expect(createBodyProjector({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBeInstanceOf(
      FakeBodyProjector,
    );
    expect(createBodyProjector({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
  });
});
