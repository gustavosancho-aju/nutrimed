import { describe, it, expect } from 'vitest';
import { FakeTextCompleter, FakeLlmProvider, type ILlmProvider } from '@nutrimed/providers';
import { runFinalReview, parseFinalReviewSection } from './final-review';

/** Provider fake com completeText roteirizado (mesmo padrão de case-state.test.ts). */
function llmWith(script: readonly string[]): { llm: ILlmProvider; completer: FakeTextCompleter } {
  const completer = new FakeTextCompleter(script);
  const base = new FakeLlmProvider('aurelio');
  const llm: ILlmProvider = {
    complete: (req) => base.complete(req),
    completeText: (req) => completer.completeText(req),
  };
  return { llm, completer };
}

const AURELIO_JSON =
  '{"faltouPerguntar":["histórico familiar de obesidade"],"examesSolicitar":["perfil lipídico"],"condutas":["reforçar diário alimentar"]}';
const PAULO_JSON =
  '{"faltouPerguntar":["dor torácica aos esforços"],"examesSolicitar":["ECG de repouso"],"condutas":[]}';
const YARA_JSON = '{"faltouPerguntar":[],"examesSolicitar":["TSH"],"condutas":["revisar em 60 dias"]}';

describe('parseFinalReviewSection (parse defensivo)', () => {
  it('JSON válido com as 3 categorias', () => {
    expect(parseFinalReviewSection(AURELIO_JSON)).toEqual({
      faltouPerguntar: ['histórico familiar de obesidade'],
      examesSolicitar: ['perfil lipídico'],
      condutas: ['reforçar diário alimentar'],
    });
  });

  it('categorias ausentes/malformadas viram lista vazia', () => {
    expect(parseFinalReviewSection('{"faltouPerguntar":["x"]}')).toEqual({
      faltouPerguntar: ['x'],
      examesSolicitar: [],
      condutas: [],
    });
  });

  it('itens não-string são descartados; strings vazias/espaços são filtradas', () => {
    expect(parseFinalReviewSection('{"faltouPerguntar":["  ok  ", "", 42, null]}')).toEqual({
      faltouPerguntar: ['ok'],
      examesSolicitar: [],
      condutas: [],
    });
  });

  it('JSON quebrado ⇒ null (nunca lança)', () => {
    expect(parseFinalReviewSection('não é json')).toBeNull();
  });

  it('cercas de código são removidas (padrão stripJsonFences)', () => {
    expect(parseFinalReviewSection('```json\n{"faltouPerguntar":["x"]}\n```')).toEqual({
      faltouPerguntar: ['x'],
      examesSolicitar: [],
      condutas: [],
    });
  });
});

describe('runFinalReview (parecer final — 1 chamada por persona, em paralelo)', () => {
  it('roda as 3 personas e devolve os pareceres parseados', async () => {
    const { llm, completer } = llmWith([AURELIO_JSON, PAULO_JSON, YARA_JSON]);
    const result = await runFinalReview(llm, ['Paciente relata cansaço.', 'Pressão 130x85.']);

    expect(result.map((r) => r.personaId).sort()).toEqual(['aurelio', 'paulo', 'yara']);
    const aurelio = result.find((r) => r.personaId === 'aurelio')!;
    expect(aurelio.examesSolicitar).toEqual(['perfil lipídico']);
    expect(aurelio.modelVersion).toBe('fake-text-v1');

    // as 3 chamadas receberam a transcrição completa numerada
    expect(completer.requests).toHaveLength(3);
    for (const req of completer.requests) {
      expect(req.prompt).toContain('1. Paciente relata cansaço.');
      expect(req.prompt).toContain('2. Pressão 130x85.');
    }
  });

  it('inclui o bloco do CaseState no prompt quando fornecido', async () => {
    const { llm, completer } = llmWith([AURELIO_JSON, PAULO_JSON, YARA_JSON]);
    await runFinalReview(llm, ['fala 1'], 'ESTADO DO CASO até aqui:\nHipóteses em cena: x.');
    for (const req of completer.requests) {
      expect(req.prompt).toContain('ESTADO DO CASO até aqui');
    }
  });

  it('persona com resposta malformada some do resultado; as demais sobrevivem', async () => {
    const { llm } = llmWith([AURELIO_JSON, 'não é json', YARA_JSON]);
    const result = await runFinalReview(llm, ['fala']);
    expect(result.map((r) => r.personaId).sort()).toEqual(['aurelio', 'yara']);
  });

  it('provider sem completeText ⇒ lista vazia (degradação graciosa, sem exceção)', async () => {
    const llm: ILlmProvider = { complete: (req) => new FakeLlmProvider('aurelio').complete(req) };
    expect(await runFinalReview(llm, ['fala'])).toEqual([]);
  });

  it('transcript vazio ainda funciona (consulta sem fala)', async () => {
    const { llm, completer } = llmWith([AURELIO_JSON, PAULO_JSON, YARA_JSON]);
    const result = await runFinalReview(llm, []);
    expect(result).toHaveLength(3);
    expect(completer.requests[0]!.prompt).toContain('(sem transcrição)');
  });
});
