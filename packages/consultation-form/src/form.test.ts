import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';
import { getAuditTrail } from '@nutrimed/audit';
import { FakeTextCompleter, type PersonaContribution } from '@nutrimed/providers';
import { sanitizeForm, applyKnownFields, EMPTY_FORM } from './schema';
import { extractConsultationForm } from './extract';
import { saveConsultationForm, loadConsultationForm } from './store';

const KEY = randomBytes(32);

const neverComplete = async (): Promise<PersonaContribution> => {
  throw new Error('a ficha não deve usar o contrato JSON de contribuição');
};

const llmReturning = (text: string) => {
  const texts = new FakeTextCompleter([text]);
  return { complete: neverComplete, completeText: (req: Parameters<typeof texts.completeText>[0]) => texts.completeText(req) };
};

describe('Ficha de consulta — sanitize', () => {
  it('descarta opção que não existe no catálogo (IA não cria checkbox fantasma)', () => {
    const form = sanitizeForm({
      doencasAssociadas: { marcados: ['hipertensao', 'lupus', 'apneia-do-sono'] },
    });
    expect(form.doencasAssociadas.marcados).toEqual(['hipertensao', 'apneia-do-sono']);
  });

  it('aceita o RÓTULO no lugar do value (a IA alterna entre os dois)', () => {
    const form = sanitizeForm({ sono: { marcados: ['Sonolência diurna', 'Ronco'] } });
    expect(form.sono.marcados).toEqual(['sonolencia-diurna', 'ronco']);
  });

  it('não duplica quando value e rótulo chegam juntos', () => {
    const form = sanitizeForm({ alimentacao: { marcados: ['refrigerante', 'Refrigerante'] } });
    expect(form.alimentacao.marcados).toEqual(['refrigerante']);
  });

  it('campo em branco/whitespace vira null, nunca string vazia', () => {
    const form = sanitizeForm({ conduta: { nutricao: '   ', medicacoes: 'Semaglutida 0,5mg' } });
    expect(form.conduta.nutricao).toBeNull();
    expect(form.conduta.medicacoes).toBe('Semaglutida 0,5mg');
  });

  it('objeto vazio devolve a ficha completa em branco (nunca lança)', () => {
    expect(sanitizeForm(undefined)).toEqual(EMPTY_FORM);
    expect(sanitizeForm('lixo')).toEqual(EMPTY_FORM);
  });

  it('risco cardiometabólico fora das 3 classes é descartado', () => {
    expect(sanitizeForm({ estratificacao: { riscoCardiometabolico: 'altíssimo' } })
      .estratificacao.riscoCardiometabolico).toBeNull();
    expect(sanitizeForm({ estratificacao: { riscoCardiometabolico: 'Moderado' } })
      .estratificacao.riscoCardiometabolico).toBe('moderado');
  });
});

describe('Ficha de consulta — dados do sistema sobrepõem os da conversa', () => {
  it('peso/altura/IMC da medição vencem o que foi dito de cabeça na consulta', () => {
    const extraido = sanitizeForm({
      identificacao: { nome: 'Rafel Bastes', idade: '41' },
      antropometria: { pesoAtual: '100 kg', pesoMaximo: '118 kg' },
    });
    const form = applyKnownFields(extraido, {
      nome: 'Rafael Bastos',
      idade: 40,
      pesoKg: 97.4,
      alturaCm: 178,
      imc: 30.75,
    });
    expect(form.identificacao.nome).toBe('Rafael Bastos');
    expect(form.identificacao.idade).toBe('40');
    expect(form.antropometria.pesoAtual).toBe('97.4 kg');
    expect(form.antropometria.altura).toBe('178 cm');
    expect(form.antropometria.imc).toBe('30.8');
  });

  it('o que o sistema NÃO tem preserva o extraído (peso máximo só existe na conversa)', () => {
    const form = applyKnownFields(sanitizeForm({ antropometria: { pesoMaximo: '118 kg' } }), {
      pesoKg: null,
      nome: 'Ana',
    });
    expect(form.antropometria.pesoMaximo).toBe('118 kg');
    expect(form.antropometria.pesoAtual).toBeNull();
  });
});

describe('Ficha de consulta — extração pela IA', () => {
  it('preenche a partir da transcrição e sanitiza o JSON', async () => {
    const { form, modelVersion } = await extractConsultationForm(
      llmReturning(
        JSON.stringify({
          objetivoPrincipal: { marcados: ['emagrecimento'], motivo: 'Quer perder 15 kg' },
          doencasAssociadas: { marcados: ['pre-diabetes', 'inventada'] },
          conduta: { nutricao: 'Déficit de 500 kcal' },
        }),
      ),
      ['Paciente quer emagrecer.', 'Exame mostrou pré-diabetes.'],
    );
    expect(form.objetivoPrincipal.marcados).toEqual(['emagrecimento']);
    expect(form.objetivoPrincipal.motivo).toBe('Quer perder 15 kg');
    expect(form.doencasAssociadas.marcados).toEqual(['pre-diabetes']);
    expect(form.conduta.nutricao).toBe('Déficit de 500 kcal');
    // nada mencionado ⇒ nada preenchido
    expect(form.exameFisico.pa).toBeNull();
    expect(form.historicoFamiliar.marcados).toEqual([]);
    expect(modelVersion).toBeDefined();
  });

  it('aceita resposta embrulhada em cerca ```json', async () => {
    const { form } = await extractConsultationForm(
      llmReturning('```json\n{"sono":{"horasPorNoite":"5"}}\n```'),
      ['Durmo cinco horas.'],
    );
    expect(form.sono.horasPorNoite).toBe('5');
  });

  it('resposta vazia é ERRO — ficha em branco jamais é gravada como sucesso', async () => {
    await expect(extractConsultationForm(llmReturning('   '), ['x'])).rejects.toThrow(/não gerou/);
  });

  it('JSON inválido vira erro legível em pt-BR, não crash de parse', async () => {
    await expect(extractConsultationForm(llmReturning('desculpe, não consegui'), ['x'])).rejects.toThrow(
      /formato inválido/,
    );
  });
});

describe('Ficha de consulta — persistência', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dr. Demo', 'x'],
    );
    consultationId = await createConsultation(exec, res.rows[0]!.id, 'P', KEY);
  });

  afterAll(async () => {
    await db.close();
  });

  it('grava cifrada, recarrega igual e audita a proveniência', async () => {
    const form = sanitizeForm({
      identificacao: { nome: 'Rafael Bastos' },
      doencasAssociadas: { marcados: ['hipertensao'], observacoes: 'Em uso de losartana.' },
    });
    await saveConsultationForm(exec, consultationId, form, KEY, {
      action: 'generate',
      modelVersion: 'claude-haiku-4-5',
    });

    const stored = await loadConsultationForm(exec, consultationId, KEY);
    expect(stored?.form).toEqual(form);
    expect(stored?.modelVersion).toBe('claude-haiku-4-5');

    // conteúdo clínico não pode estar legível na coluna (NFR9)
    const raw = await exec.query<{ content_enc: string }>(
      'SELECT content_enc FROM consultation_form WHERE consultation_id = $1',
      [consultationId],
    );
    expect(raw.rows[0]!.content_enc).not.toContain('Rafael Bastos');
    expect(raw.rows[0]!.content_enc).not.toContain('losartana');

    const trail = await getAuditTrail(exec, consultationId);
    expect(trail.some((e) => e.triggeredBy === 'consultation-form-generate')).toBe(true);
  });

  it('a revisão do médico substitui o rascunho e vira human-edit (1 ficha por consulta)', async () => {
    const revisada = sanitizeForm({ conduta: { medicacoes: 'Suspender metformina.' } });
    await saveConsultationForm(exec, consultationId, revisada, KEY, { action: 'edit' });

    const stored = await loadConsultationForm(exec, consultationId, KEY);
    expect(stored?.form.conduta.medicacoes).toBe('Suspender metformina.');
    expect(stored?.modelVersion).toBe('human-edit');

    const count = await exec.query<{ count: string | number }>(
      'SELECT COUNT(*) AS count FROM consultation_form WHERE consultation_id = $1',
      [consultationId],
    );
    expect(Number(count.rows[0]!.count)).toBe(1);

    const trail = await getAuditTrail(exec, consultationId);
    expect(trail.some((e) => e.triggeredBy === 'consultation-form-edit')).toBe(true);
  });

  it('consulta sem ficha devolve null', async () => {
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['outro@nutrimed.test', 'Dra. Outra', 'x'],
    );
    const outra = await createConsultation(exec, res.rows[0]!.id, 'Q', KEY);
    expect(await loadConsultationForm(exec, outra, KEY)).toBeNull();
  });
});
