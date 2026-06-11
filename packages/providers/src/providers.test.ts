import { describe, it, expect } from 'vitest';
import type {
  ISttProvider,
  ILlmProvider,
  IKnowledgeRetriever,
  IVideoAssetProvider,
} from './interfaces';
import type { TranscriptSegment, KbChunk, VideoState } from './types';
import {
  FakeSttProvider,
  FakeLlmProvider,
  FakeKnowledgeRetriever,
  FakeVideoAssetProvider,
} from './fakes';

// Os fakes são atribuídos às interfaces — prova de conformidade de tipo (AC1/AC2).
const stt: ISttProvider = new FakeSttProvider();
const llm: ILlmProvider = new FakeLlmProvider();
const retriever: IKnowledgeRetriever = new FakeKnowledgeRetriever();
const video: IVideoAssetProvider = new FakeVideoAssetProvider();

describe('ISttProvider (fake) — streaming parciais/finais', () => {
  it('emite uma sequência determinística terminando em segmento final', async () => {
    const session = stt.openStream({ lang: 'pt-BR' });
    const got: TranscriptSegment[] = [];
    for await (const segment of session) {
      got.push(segment);
    }
    await session.close();

    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(got.some((s) => !s.isFinal)).toBe(true); // há parciais
    expect(got.at(-1)?.isFinal).toBe(true); // termina no final
  });

  it('close() interrompe a iteração sem emitir mais segmentos', async () => {
    const session = new FakeSttProvider([
      { text: 'a', isFinal: false },
      { text: 'a b', isFinal: true },
    ]).openStream({ lang: 'pt-BR' });
    await session.close();
    const got: TranscriptSegment[] = [];
    for await (const segment of session) got.push(segment);
    expect(got).toHaveLength(0);
  });
});

describe('ILlmProvider (fake) — PersonaContribution previsível', () => {
  it('retorna contribuição determinística derivada do transcript', async () => {
    const context: KbChunk[] = [{ id: 'k1', personaId: 'yara', text: 'TSH' }];
    const contribution = await llm.complete({
      system: 'persona Yara',
      context,
      transcript: 'cansaço e platô',
    });
    expect(contribution.personaId).toBe('aurelio'); // default do fake
    expect(contribution.type).toBe('sugestao');
    expect(contribution.severity).toBe('normal');
    expect(contribution.text).toContain('cansaço e platô');
    expect(contribution.kbSources).toEqual(['k1']); // proveniência (audit 1.5)
  });

  it('permite configurar persona e tipo', async () => {
    const yara = new FakeLlmProvider('yara', 'hipotese');
    const contribution = await yara.complete({ system: '', context: [], transcript: 't' });
    expect(contribution.personaId).toBe('yara');
    expect(contribution.type).toBe('hipotese');
  });
});

describe('IKnowledgeRetriever (fake) — escopo por persona (FR21)', () => {
  it('recupera SÓ chunks do namespace da persona pedida', async () => {
    const paulo = await retriever.retrieve('paulo', 'risco', 10);
    expect(paulo.length).toBeGreaterThan(0);
    expect(paulo.every((c) => c.personaId === 'paulo')).toBe(true);
  });

  it('não vaza conhecimento de outra persona', async () => {
    const yara = await retriever.retrieve('yara', 'qualquer', 10);
    expect(yara.some((c) => c.personaId === 'paulo')).toBe(false);
    expect(yara.some((c) => c.personaId === 'aurelio')).toBe(false);
  });

  it('respeita o limite k', async () => {
    const catalog: KbChunk[] = [
      { id: 'a1', personaId: 'aurelio', text: '1' },
      { id: 'a2', personaId: 'aurelio', text: '2' },
      { id: 'a3', personaId: 'aurelio', text: '3' },
    ];
    const r = new FakeKnowledgeRetriever(catalog);
    expect(await r.retrieve('aurelio', 'q', 2)).toHaveLength(2);
  });

  it('persona sem chunks retorna lista vazia (não erro)', async () => {
    const empty = new FakeKnowledgeRetriever([]);
    expect(await empty.retrieve('aurelio', 'q', 5)).toEqual([]);
  });
});

describe('IVideoAssetProvider (fake) — catálogo pré-renderizado (ADR-007)', () => {
  it('resolve um ClipRef determinístico por (persona, estado)', () => {
    const states: VideoState[] = ['ouvindo', 'pensando', 'sinalizando'];
    for (const state of states) {
      const clip = video.getClip('aurelio', state);
      expect(clip.personaId).toBe('aurelio');
      expect(clip.state).toBe(state);
      expect(clip.url).toContain(`aurelio/${state}`);
    }
  });
});
