import { describe, it, expect, vi } from 'vitest';
import { KimiLlmProvider, KimiLlmError, parseKimiContribution } from './kimi';

/** fetch fake que devolve uma resposta OpenAI-compatível da Moonshot. */
function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const okResponse = {
  model: 'kimi-k3',
  choices: [
    {
      message: {
        content: '## Nota\nTexto do documento.',
        reasoning_content: 'raciocínio interno que deve ser descartado',
      },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
};

describe('KimiLlmProvider.completeText', () => {
  it('extrai o content (ignorando reasoning_content) e reporta a versão do modelo', async () => {
    const fetchImpl = fakeFetch(okResponse);
    const llm = new KimiLlmProvider({ apiKey: 'k', personaId: 'aurelio', fetchImpl });
    const res = await llm.completeText({ system: 'sys', prompt: 'p', maxTokens: 4000 });
    expect(res.text).toBe('## Nota\nTexto do documento.');
    expect(res.modelVersion).toBe('kimi-k3');
  });

  it('envia Bearer auth, reasoning_effort low (default) e o max_tokens pedido', async () => {
    const fetchImpl = fakeFetch(okResponse);
    const llm = new KimiLlmProvider({ apiKey: 'segredo', personaId: 'aurelio', fetchImpl });
    await llm.completeText({ system: 'sys', prompt: 'p', maxTokens: 4000 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain('api.moonshot.ai');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer segredo');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('kimi-k3');
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_tokens).toBe(4000);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'p' },
    ]);
  });

  it('reporta usage (prompt/completion tokens) via onUsage — custo E10', async () => {
    const onUsage = vi.fn();
    const llm = new KimiLlmProvider({
      apiKey: 'k',
      personaId: 'aurelio',
      fetchImpl: fakeFetch(okResponse),
      onUsage,
    });
    await llm.completeText({ system: 's', prompt: 'p' });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50 });
  });

  it('erro da API vira KimiLlmError kind=api com a mensagem do provedor', async () => {
    const llm = new KimiLlmProvider({
      apiKey: 'k',
      personaId: 'aurelio',
      fetchImpl: fakeFetch({ error: { message: 'quota exceeded' } }, 429),
    });
    await expect(llm.completeText({ system: 's', prompt: 'p' })).rejects.toMatchObject({
      name: 'KimiLlmError',
      kind: 'api',
    });
  });

  it('resposta sem content vira KimiLlmError kind=parse', async () => {
    const llm = new KimiLlmProvider({
      apiKey: 'k',
      personaId: 'aurelio',
      fetchImpl: fakeFetch({ choices: [{ message: { reasoning_content: 'só raciocínio' } }] }),
    });
    await expect(llm.completeText({ system: 's', prompt: 'p' })).rejects.toMatchObject({
      name: 'KimiLlmError',
      kind: 'parse',
    });
  });

  it('apiKey vazia é recusada na construção (config)', () => {
    expect(() => new KimiLlmProvider({ apiKey: '', personaId: 'aurelio' })).toThrow(KimiLlmError);
  });
});

describe('KimiLlmProvider.complete (contrato JSON de contribuição)', () => {
  const contributionResponse = {
    model: 'kimi-k3',
    choices: [
      {
        message: {
          content: '{"type":"atencao","severity":"critical","text":"Verificar interação.","relevanceScore":0.9}',
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };

  it('parseia a contribuição e propaga personaId da config + kbSources do contexto', async () => {
    const llm = new KimiLlmProvider({
      apiKey: 'k',
      personaId: 'paulo',
      fetchImpl: fakeFetch(contributionResponse),
    });
    const c = await llm.complete({
      system: 'persona',
      context: [{ id: 'kb-1', personaId: 'paulo', text: 'trecho', source: 's' }],
      transcript: 'fala do paciente',
    });
    expect(c.personaId).toBe('paulo');
    expect(c.type).toBe('atencao');
    expect(c.severity).toBe('critical');
    expect(c.kbSources).toEqual(['kb-1']);
    expect(c.modelVersion).toBe('kimi-k3');
  });

  it('{"skip":true} vira contribuição skip (anti-repetição B1)', async () => {
    const llm = new KimiLlmProvider({
      apiKey: 'k',
      personaId: 'yara',
      fetchImpl: fakeFetch({ choices: [{ message: { content: '{"skip":true}' } }] }),
    });
    const c = await llm.complete({ system: 's', context: [], transcript: 't', allowSkip: true });
    expect(c.skip).toBe(true);
    expect(c.text).toBe('');
  });
});

describe('parseKimiContribution', () => {
  it('tolera cercas de código em volta do JSON', () => {
    const p = parseKimiContribution('```json\n{"type":"sugestao","severity":"normal","text":"ok"}\n```');
    expect(p.text).toBe('ok');
  });

  it('JSON inválido lança KimiLlmError parse', () => {
    expect(() => parseKimiContribution('não é json')).toThrow(KimiLlmError);
  });

  it('type/severity desconhecidos degradam para sugestao/normal', () => {
    const p = parseKimiContribution('{"type":"x","severity":"y","text":"t"}');
    expect(p.type).toBe('sugestao');
    expect(p.severity).toBe('normal');
  });
});
