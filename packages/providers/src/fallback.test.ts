import { describe, it, expect, vi } from 'vitest';
import { FallbackLlmProvider } from './fallback';
import type { ILlmProvider } from './interfaces';

const req = { system: 's', prompt: 'p' };

function text(result: string | Error): ILlmProvider {
  return {
    complete: vi.fn(),
    completeText: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return { text: result, modelVersion: `m-${result}` };
    }),
  };
}

describe('FallbackLlmProvider.completeText', () => {
  it('usa o primário quando ele responde, sem tocar no reserva', async () => {
    const primary = text('kimi');
    const fallback = text('claude');
    const llm = new FallbackLlmProvider(primary, fallback);
    await expect(llm.completeText(req)).resolves.toEqual({ text: 'kimi', modelVersion: 'm-kimi' });
    expect(fallback.completeText).not.toHaveBeenCalled();
  });

  it('cai para o reserva quando o primário falha (ex.: 429 de cota) e avisa', async () => {
    const err = new Error('Chat Completions API falhou (429): insufficient balance');
    const onFallback = vi.fn();
    const fallback = text('claude');
    const llm = new FallbackLlmProvider(text(err), fallback, onFallback);
    await expect(llm.completeText(req)).resolves.toEqual({ text: 'claude', modelVersion: 'm-claude' });
    expect(fallback.completeText).toHaveBeenCalledWith(req);
    expect(onFallback).toHaveBeenCalledWith(err);
  });

  it('propaga o erro do reserva quando os dois falham', async () => {
    const llm = new FallbackLlmProvider(text(new Error('kimi')), text(new Error('claude fora')));
    await expect(llm.completeText(req)).rejects.toThrow('claude fora');
  });

  it('tenta o primário de novo na chamada seguinte (volta sozinho após recarga)', async () => {
    const primary = text(new Error('429'));
    const llm = new FallbackLlmProvider(primary, text('claude'));
    await llm.completeText(req);
    await llm.completeText(req);
    expect(primary.completeText).toHaveBeenCalledTimes(2);
  });
});
