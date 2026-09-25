import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocumentLlm, DOCUMENT_MODEL } from './document-llm';

function stubAnthropic() {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({ model: 'claude-sonnet-5', content: [{ type: 'text', text: 'nota' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('buildDocumentLlm', () => {
  it('sem nenhuma key devolve null (a action usa o fake de dev)', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('KIMI_API_KEY', '');
    expect(buildDocumentLlm()).toBeNull();
  });

  it('só com a key da Anthropic escreve os documentos no SONNET, não no Haiku do board', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'k');
    vi.stubEnv('KIMI_API_KEY', '');
    const fetchMock = stubAnthropic();
    const result = await buildDocumentLlm()!.completeText!({ system: 's', prompt: 'p', maxTokens: 4000 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(DOCUMENT_MODEL).toBe('claude-sonnet-5');
    expect(body.model).toBe(DOCUMENT_MODEL);
    expect(body.max_tokens).toBe(4000);
    expect(result.modelVersion).toBe('claude-sonnet-5');
  });
});
