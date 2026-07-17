import { describe, it, expect } from 'vitest';
import type { KbChunk, LlmCompletionRequest, PersonaContribution } from '@nutrimed/providers';
import { NamespacedKnowledgeStore } from './store';
import { ingest, chunkContent, seedSources } from './ingest';
import { PersonaReasoner, buildPersonaSystem, PERSONA_PROFILES } from './reasoner';

const SEED = `# Base seed

## ❤️ Dr. Paulo Tavares — Cardiologista

**Escopo:** risco cardiovascular, hipertensão, segurança cardiovascular de fármacos.

- Menção a pressão alta, palpitação, dor no peito → sugere checar pressão arterial e frequência cardíaca
- Prescrição de GLP-1, sibutramina, termogênicos → alerta de segurança cardiovascular e caminho seguro

## 🔬 Dra. Yara Nakamura — Endocrinologista

**Escopo:** eixo tireoidiano, resistência insulínica, metabolismo.

- Cansaço, ganho de peso, frio, queda de cabelo → hipótese de tireoide, sugerir TSH e T4 livre
- Platô no emagrecimento → investigar causa metabólica hormonal
`;

function setupStore(version = 'seed-v1') {
  const store = new NamespacedKnowledgeStore();
  ingest(store, seedSources(SEED), version);
  return store;
}

describe('Story 5.2 — Pipeline de ingestão versionado + proveniência', () => {
  it('ingere a seed por persona com proveniência fonte@versão em cada chunk', async () => {
    const store = setupStore();
    expect(store.sizeOf('paulo')).toBeGreaterThan(0);
    expect(store.sizeOf('yara')).toBeGreaterThan(0);
    expect(store.versionOf('paulo')).toBe('seed-v1');

    const chunks = await store.retrieve('paulo', 'segurança cardiovascular GLP-1', 5);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.source).toMatch(/personas-knowledge-base-seed\.md#paulo@seed-v1/);
      expect(chunk.personaId).toBe('paulo');
    }
  });

  it('R8: re-ingestão com nova versão SUBSTITUI o namespace sem resíduo', async () => {
    const store = setupStore('seed-v1');
    const before = store.sizeOf('paulo');
    expect(before).toBeGreaterThan(0);

    ingest(
      store,
      [{ personaId: 'paulo', source: 'curadoria-sbc-2026.md', content: 'Diretriz curada: avaliação cardiológica estruturada antes de agonistas GLP-1 em pacientes sintomáticos.' }],
      'curada-v1',
    );
    expect(store.versionOf('paulo')).toBe('curada-v1');
    expect(store.sizeOf('paulo')).toBe(1); // sem resíduo da seed

    const chunks = await store.retrieve('paulo', 'GLP-1 avaliação cardiológica', 5);
    expect(chunks.every((c) => c.source?.includes('curadoria-sbc-2026.md@curada-v1'))).toBe(true);
    // outro namespace intacto
    expect(store.versionOf('yara')).toBe('seed-v1');
  });

  it('chunker descarta ruído curto e preserva conteúdo', () => {
    const chunks = chunkContent('yara', 'f.md', '# T\n\n- ok\n- Cansaço com ganho de peso sugere investigar o eixo tireoidiano.', 'v1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.id).toBe('yara:v1:0');
  });
});

describe('Story 5.1 — Namespaces isolados (FR21)', () => {
  it('query de cardio NUNCA retorna chunk de endo (e vice-versa)', async () => {
    const store = setupStore();
    // termos tireoidianos pedidos NO NAMESPACE do Paulo → nada de Yara vaza
    const fromPaulo = await store.retrieve('paulo', 'tireoide TSH cansaço hipótese', 10);
    expect(fromPaulo.every((c) => c.personaId === 'paulo')).toBe(true);

    const fromYara = await store.retrieve('yara', 'pressão arterial palpitação segurança', 10);
    expect(fromYara.every((c) => c.personaId === 'yara')).toBe(true);
  });

  it('namespace vazio retorna lista vazia — nunca vaza de outro', async () => {
    const store = setupStore(); // aurelio não está na SEED de teste
    expect(await store.retrieve('aurelio', 'GLP-1 cardiovascular', 5)).toEqual([]);
  });

  it('k é respeitado e ranking é determinístico', async () => {
    const store = setupStore();
    const top1 = await store.retrieve('paulo', 'GLP-1 sibutramina segurança cardiovascular', 1);
    expect(top1).toHaveLength(1);
    expect(top1[0]!.text).toContain('GLP-1');
  });

  it('chunk de outra persona é rejeitado na escrita do namespace (defesa em profundidade)', () => {
    const store = new NamespacedKnowledgeStore();
    const foreign: KbChunk = { id: 'x', personaId: 'yara', text: 'conteúdo endo' };
    expect(() => store.replaceNamespace('paulo', [foreign], 'v1')).toThrow(/FR21/);
  });
});

describe('Story 5.3 — PersonaReasoner + prompts restritos (T6)', () => {
  class CapturingLlm {
    lastRequest: LlmCompletionRequest | null = null;
    async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
      this.lastRequest = req;
      return {
        personaId: 'aurelio', // modelo "errou" a persona de propósito — reasoner corrige
        type: 'atencao',
        severity: 'critical',
        text: 'Vale checar PA e FC antes de iniciar.',
        modelVersion: 'fake-v1',
      };
    }
  }

  it('fluxo candidato→KB escopada→LLM→contribuição com kbSources (proveniência)', async () => {
    const store = setupStore();
    const llm = new CapturingLlm();
    const reasoner = new PersonaReasoner(store, llm);

    const contribution = await reasoner.reason({
      personaId: 'paulo',
      query: 'GLP-1 palpitação segurança cardiovascular',
      transcript: 'Vou iniciar semaglutida; paciente refere palpitação.',
    });

    expect(contribution.personaId).toBe('paulo'); // persona é decisão do board
    expect(contribution.kbSources!.length).toBeGreaterThan(0);
    expect(contribution.kbSources!.every((id) => id.startsWith('paulo:'))).toBe(true);
    // contexto entregue ao LLM veio só do namespace do Paulo
    expect(llm.lastRequest!.context.every((c) => c.personaId === 'paulo')).toBe(true);
  });

  it('system prompt contém escopo da persona + regras anti-extrapolação (verificável — AC3)', () => {
    for (const personaId of ['aurelio', 'paulo', 'yara'] as const) {
      const system = buildPersonaSystem(PERSONA_PROFILES[personaId]);
      expect(system).toContain(PERSONA_PROFILES[personaId].scope);
      expect(system).toContain('NUNCA opine fora do seu escopo');
      expect(system).toContain('não invente diretrizes');
      expect(system).toContain('tom de sugestão');
      // ancoragem na conversa (feedback do piloto 2026-07-15): a KB fundamenta,
      // não pauta — e sem material dito, a persona cala ({"skip":true})
      expect(system).toContain('efetivamente DITO');
      expect(system).toContain('nunca pauta o assunto');
      expect(system).toContain('NUNCA presuma fatos');
      expect(system).toContain('material suficiente');
    }
  });

  it('reasoner usa o system restrito na chamada do LLM', async () => {
    const store = setupStore();
    const llm = new CapturingLlm();
    await new PersonaReasoner(store, llm).reason({
      personaId: 'yara',
      query: 'platô cansaço tireoide',
      transcript: 'Platô há 2 meses com cansaço.',
    });
    expect(llm.lastRequest!.system).toContain('Dra. Yara Nakamura');
    expect(llm.lastRequest!.system).toContain('eixo tireoidiano');
    expect(llm.lastRequest!.system).toContain('NUNCA opine fora do seu escopo');
  });
});
