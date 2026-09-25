import { describe, it, expect, vi } from 'vitest';
import { ClaudeLabExtractor, DEFAULT_LAB_MODEL } from './claude-extractor';

const PDF = { base64: 'JVBERi0=', filename: 'laudo.pdf' } as never;

function fetchReturning(json: unknown) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: JSON.stringify(json) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

function sentBody(fetchImpl: ReturnType<typeof fetchReturning>) {
  const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string);
}

describe('ClaudeLabExtractor — modelo da leitura de laudos', () => {
  it('lê o laudo com o SONNET por padrão, não com o Haiku do board', async () => {
    const fetchImpl = fetchReturning({ measuredAt: null, analytes: [], notes: '' });
    const extractor = new ClaudeLabExtractor({ apiKey: 'k', fetchImpl });
    await extractor.extractPanel(PDF);
    expect(DEFAULT_LAB_MODEL).toBe('claude-sonnet-5');
    expect(sentBody(fetchImpl).model).toBe('claude-sonnet-5');
    expect(extractor.modelVersion).toBe('claude-sonnet-5');
  });

  it('o painel completo mantém o teto de 16000 tokens (70 analitos não podem truncar o JSON)', async () => {
    const fetchImpl = fetchReturning({ measuredAt: null, analytes: [], notes: '' });
    await new ClaudeLabExtractor({ apiKey: 'k', fetchImpl }).extractPanel(PDF);
    expect(sentBody(fetchImpl).max_tokens).toBe(16000);
  });

  it('o modelo continua configurável (POC comparando modelos)', async () => {
    const fetchImpl = fetchReturning({ measuredAt: null, analytes: [], notes: '' });
    await new ClaudeLabExtractor({ apiKey: 'k', model: 'outro-modelo', fetchImpl }).extractPanel(PDF);
    expect(sentBody(fetchImpl).model).toBe('outro-modelo');
  });
});
