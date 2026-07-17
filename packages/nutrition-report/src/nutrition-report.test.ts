import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor, pgliteExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';
import { getAuditTrail } from '@nutrimed/audit';
import { FakeTextCompleter, type ILlmProvider, type PersonaContribution } from '@nutrimed/providers';
import { extractDietRecall, sanitizeRecall, type RecallItem } from './extract';
import { mapRecallToTaco } from './map';
import { computeNutrition } from './compute';
import { renderComputationForPrompt, writeReportDraft } from './report';
import { loadNutritionReport, saveNutritionReport } from './store';

const KEY = randomBytes(32);

function fakeTextLlm(reply: string): ILlmProvider {
  return {
    complete: async () => {
      throw new Error('não usado');
    },
    completeText: async () => ({ text: reply, modelVersion: 'fake' }),
  };
}

describe('13.2a — extração do recordatório (fronteira de confiança)', () => {
  it('extrai itens válidos de JSON com cercas de código e campos sujos', async () => {
    const llm = fakeTextLlm(
      '```json\n[' +
        '{"food":"arroz branco cozido","quantity":4,"unit":"colher de sopa","meal":"almoco"},' +
        '{"food":"café","meal":"cafe","hack":"ignorar"},' +
        '{"food":"","quantity":2},' +
        '{"food":"suco de laranja","quantity":-3,"unit":"copo"},' +
        '{"food":"pão francês","quantity":"duas"}' +
        ']\n```',
    );
    const items = await extractDietRecall(llm, ['Comi arroz no almoço.']);
    expect(items).toEqual([
      { food: 'arroz branco cozido', quantity: 4, unit: 'colher de sopa', meal: 'almoco' },
      { food: 'café', meal: 'cafe' },
      { food: 'suco de laranja' }, // quantity inválida descartada, item mantido
      { food: 'pão francês' },
    ]);
  });

  it('saída malformada do modelo ⇒ [] (médico regenera), e sanitize rejeita não-arrays', async () => {
    const llm = fakeTextLlm('desculpe, não consegui');
    expect(await extractDietRecall(llm, ['...'])).toEqual([]);
    expect(sanitizeRecall({ food: 'x' })).toEqual([]);
    expect(sanitizeRecall(null)).toEqual([]);
  });

  it('exige completeText do provider (contrato explícito, não falha silenciosa)', async () => {
    const llm = { complete: async () => ({}) as PersonaContribution };
    await expect(extractDietRecall(llm as ILlmProvider, ['...'])).rejects.toThrow(/completeText/);
  });
});

describe('13.2b — mapeamento TACO + porções', () => {
  it('quantidade+unidade conhecidas ⇒ gramas exatos, sem flag de estimativa', () => {
    const [mapped] = mapRecallToTaco([
      { food: 'arroz branco cozido', quantity: 4, unit: 'colheres de sopa' },
    ]);
    expect(mapped!.status).toBe('matched');
    expect(mapped!.taco?.description.toLowerCase()).toContain('arroz');
    expect(mapped!.grams).toBe(60);
    expect(mapped!.gramsEstimated).toBe(false);
    // cálculo determinístico: per100g * 60/100
    expect(mapped!.nutrients!.kcal).toBeGreaterThan(0);
  });

  it('sem quantidade ⇒ porção padrão SINALIZADA como estimativa', () => {
    const [mapped] = mapRecallToTaco([{ food: 'feijão carioca cozido' }]);
    expect(mapped!.gramsEstimated).toBe(true);
    expect(mapped!.portionLabel).toBeTruthy();
    expect(mapped!.grams).toBe(100);
  });

  it('quantidade sem unidade ("2 bananas") ⇒ quantidade × porção unitária, sinalizada', () => {
    const [mapped] = mapRecallToTaco([{ food: 'banana prata', quantity: 2 }]);
    expect(mapped!.gramsEstimated).toBe(true);
    expect(mapped!.grams).toBe(200);
  });

  it('alimento inexistente na TACO ⇒ unmatched sinalizado, nutrients null', () => {
    const [mapped] = mapRecallToTaco([{ food: 'xylitolburger quântico' }]);
    expect(mapped!.status).toBe('unmatched');
    expect(mapped!.nutrients).toBeNull();
    expect(mapped!.grams).toBeNull();
  });
});

describe('13.2c — totais e meta', () => {
  const recall: RecallItem[] = [
    { food: 'arroz branco cozido', quantity: 100, unit: 'g' },
    { food: 'alimento inventado zzz' },
  ];

  it('soma apenas itens com match e lista unmatched separadamente', () => {
    const computation = computeNutrition(mapRecallToTaco(recall));
    expect(computation.unmatched).toEqual([{ food: 'alimento inventado zzz' }]);
    expect(computation.totals.kcal).toBeGreaterThan(100); // arroz cozido ~128 kcal/100g
    expect(computation.tacoVersion).toBe('taco-4ed');
    expect(computation.goalDelta).toBeUndefined();
  });

  it('com meta vigente calcula delta consumo−meta', () => {
    const goal = { kcal: 2000, protein: 120, carbs: 200, fat: 60 };
    const computation = computeNutrition(mapRecallToTaco(recall), goal);
    expect(computation.goal).toEqual(goal);
    expect(computation.goalDelta!.kcal).toBeCloseTo((computation.totals.kcal ?? 0) - 2000, 1);
    expect(computation.goalDelta!.protein).toBeLessThan(0);
  });
});

describe('13.2d — redação do relatório', () => {
  it('o prompt leva os números calculados, flags de estimativa e fontes TACO', () => {
    const computation = computeNutrition(
      mapRecallToTaco([{ food: 'arroz branco cozido' }, { food: 'zzz inventado' }]),
      { kcal: 1800, protein: 100, carbs: 180, fat: 55 },
    );
    const prompt = renderComputationForPrompt(computation, { goalLabel: 'meta de 2026-07-01' });
    expect(prompt).toContain('~estimada');
    expect(prompt).toContain('[TACO ');
    expect(prompt).toContain('SEM correspondência na TACO');
    expect(prompt).toContain('Delta consumo−meta');
    expect(prompt).toContain('meta de 2026-07-01');
  });

  it('gera markdown via completeText e rejeita resposta vazia', async () => {
    const neverComplete = async (): Promise<PersonaContribution> => {
      throw new Error('o relatório não deve usar o contrato JSON de contribuição');
    };
    const texts = new FakeTextCompleter(['## Recordatório alimentar\n...']);
    const llm: ILlmProvider = {
      complete: neverComplete,
      completeText: (req) => texts.completeText(req),
    };
    const computation = computeNutrition(mapRecallToTaco([{ food: 'arroz branco cozido' }]));
    const draft = await writeReportDraft(llm, computation);
    expect(draft.text).toContain('Recordatório alimentar');
    expect(draft.modelVersion).toBe('fake-text-v1');
    const req = texts.requests[0]!;
    expect(req.system).toContain('PROIBIDO alterar');
    expect(req.system).toContain('revisado e validado pelo médico');
    expect(req.maxTokens).toBeGreaterThanOrEqual(4000);

    const emptyTexts = new FakeTextCompleter(['  ']);
    const emptyLlm: ILlmProvider = {
      complete: neverComplete,
      completeText: (req) => emptyTexts.completeText(req),
    };
    await expect(writeReportDraft(emptyLlm, computation)).rejects.toThrow(/não gerou conteúdo/);

    // sem completeText ⇒ erro claro, sem fallback ao caminho JSON truncável
    await expect(writeReportDraft({ complete: neverComplete }, computation)).rejects.toThrow(
      /completeText/,
    );
  });
});

describe('13.3 — persistência cifrada + auditada (NFR9/NFR10)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dra. Demo', 'x'],
    );
    consultationId = await createConsultation(exec, res.rows[0]!.id, 'P', KEY);
  });

  afterAll(async () => {
    await db.close();
  });

  it('salva cifrado, carrega decifrado com data estruturado, audita com fontes TACO', async () => {
    const computation = computeNutrition(
      mapRecallToTaco([{ food: 'arroz branco cozido', quantity: 100, unit: 'g' }]),
    );
    const content = '## Recordatório alimentar\nArroz branco cozido 100 g.';
    await saveNutritionReport(exec, consultationId, content, KEY, {
      action: 'generate',
      modelVersion: 'claude-haiku-4-5',
      data: computation,
    });

    // storage bruto ilegível (NFR9)
    const raw = await exec.query<{ content_enc: string; data_enc: string }>(
      'SELECT content_enc, data_enc FROM nutrition_report WHERE consultation_id = $1',
      [consultationId],
    );
    expect(raw.rows[0]!.content_enc).not.toContain('Arroz');
    expect(raw.rows[0]!.data_enc).not.toContain('arroz');

    const report = await loadNutritionReport(exec, consultationId, KEY);
    expect(report!.content).toBe(content);
    expect(report!.tacoVersion).toBe('taco-4ed');
    expect(report!.data!.items[0]!.taco!.description.toLowerCase()).toContain('arroz');

    // trilha com proveniência TACO (NFR10)
    const trail = await getAuditTrail(exec, consultationId);
    const entry = trail.find((t) => t.triggeredBy === 'nutrition-report-generate');
    expect(entry).toBeDefined();
    expect(entry!.modelVersion).toBe('claude-haiku-4-5');
    expect(JSON.stringify(entry!.kbSources)).toContain('taco:');
  });

  it('edição do médico atualiza o texto, PRESERVA o cálculo e audita como human-edit', async () => {
    await saveNutritionReport(exec, consultationId, '## Editado pelo médico', KEY, { action: 'edit' });
    const report = await loadNutritionReport(exec, consultationId, KEY);
    expect(report!.content).toBe('## Editado pelo médico');
    expect(report!.data).not.toBeNull(); // cálculo da geração preservado

    const trail = await getAuditTrail(exec, consultationId);
    const edit = trail.find((t) => t.triggeredBy === 'nutrition-report-edit');
    expect(edit!.modelVersion).toBe('human-edit');
  });

  it('regenerar sobrescreve texto E cálculo (1:1 com a consulta)', async () => {
    const computation = computeNutrition(mapRecallToTaco([{ food: 'feijão carioca cozido' }]));
    await saveNutritionReport(exec, consultationId, '## Regenerado', KEY, {
      action: 'generate',
      modelVersion: 'claude-haiku-4-5',
      data: computation,
    });
    const report = await loadNutritionReport(exec, consultationId, KEY);
    expect(report!.content).toBe('## Regenerado');
    expect(report!.data!.items[0]!.taco!.description.toLowerCase()).toContain('feijão');
    const count = await exec.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM nutrition_report WHERE consultation_id = $1',
      [consultationId],
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it('consulta sem relatório ⇒ null', async () => {
    const other = await createConsultation(
      exec,
      (await exec.query<{ id: string }>('SELECT id FROM app_user LIMIT 1')).rows[0]!.id,
      'P2',
      KEY,
    );
    expect(await loadNutritionReport(exec, other, KEY)).toBeNull();
  });
});
