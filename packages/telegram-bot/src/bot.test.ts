import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@nutrimed/db';
import {
  setNutritionGoal,
  sumFoodLogForDay,
  listFoodLogByDay,
  softDeleteFoodLogEntry,
  type Meal,
} from '@nutrimed/patients';
import { createPairingCode, redeemPairingCode } from '@nutrimed/telegram-link';
import { FakeFoodEstimator, type FoodImageInput } from '@nutrimed/food-vision';
import { FakeLlmProvider, type ILlmProvider } from '@nutrimed/providers';
import {
  handleStart,
  handlePhoto,
  handleCorrection,
  handleAte,
  handleToday,
  handleGoal,
  handleUpdate,
  handleMealCommand,
  type BotDeps,
  type BotReply,
  type BotUpdate,
} from './bot';
import { mealCallbackData } from './meal';


const KEY = randomBytes(32);
const IMAGE: FoodImageInput = { base64: 'x', mediaType: 'image/jpeg' };
const NOW = () => new Date('2026-07-01T12:00:00Z');

async function insertUser(exec: SqlExecutor, email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Dra. Demo', 'x'],
  );
  return res.rows[0]!.id;
}

async function insertPatient(exec: SqlExecutor, userId: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO patient (user_id, name_enc) VALUES ($1, $2) RETURNING id',
    [userId, 'enc-name'],
  );
  return res.rows[0]!.id;
}

/**
 * O fluxo do paciente em DOIS passos desde o E16 Fase 2: manda o prato, o bot
 * pergunta a refeição com botões, ele toca em uma. Devolve a resposta FINAL (a
 * da confirmação), que é onde estão o progresso do dia e a orientação.
 *
 * Existe porque a Fase 2 mudou o contrato "foto/texto ⇒ registro imediato" que
 * estava assado nesta suíte — 21 testes dependiam dele.
 */
async function logAndConfirm(
  d: BotDeps,
  chatId: string,
  update: Omit<BotUpdate, 'chatId'>,
  meal: Meal = 'almoco',
): Promise<{ ask: BotReply; confirm: BotReply }> {
  const ask = await handleUpdate(d, { chatId, ...update });
  if (!ask?.buttons) throw new Error(`esperava botões de refeição, veio: ${ask?.text ?? '(nada)'}`);
  const botao = ask.buttons.flat().find((b) => b.data === mealCallbackData(pendingIdOf(ask), meal));
  const confirm = await handleUpdate(d, { chatId, callbackData: botao!.data, callbackId: 'cb-test' });
  return { ask, confirm: confirm! };
}

/** O id do pendente vem embutido no `callback_data` de qualquer um dos botões. */
function pendingIdOf(reply: BotReply): string {
  const data = reply.buttons!.flat()[0]!.data;
  const compacto = data.split(':')[1]!;
  // remonta o uuid com hífens (8-4-4-4-12)
  return [
    compacto.slice(0, 8), compacto.slice(8, 12), compacto.slice(12, 16),
    compacto.slice(16, 20), compacto.slice(20),
  ].join('-');
}

describe('Telegram Bot — lógica pura (E12 — 12.6)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let deps: BotDeps;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'medico@nutrimed.test');
    deps = {
      db: exec,
      key: KEY,
      estimator: new FakeFoodEstimator(),
      now: NOW,
      tzOffsetMinutes: -180,
      downloadPhoto: async () => IMAGE, // transporte fake: /corrigir re-baixa a foto pelo photoRef
    };
  });

  afterAll(async () => {
    await db.close();
  });

  /** Vincula um chat a um paciente novo e retorna o patientId. */
  async function pairNewChat(chatId: string): Promise<string> {
    const patientId = await insertPatient(exec, userId);
    const code = await createPairingCode(exec, patientId, userId);
    await redeemPairingCode(exec, chatId, code);
    return patientId;
  }

  describe('/start — boas-vindas e pareamento', () => {
    it('sem código: dá boas-vindas e explica o pareamento', async () => {
      const r = await handleStart(deps, 'chat-welcome');
      expect(r.text).toMatch(/c[óo]digo/i);
      expect(r.text).toMatch(/\/start/i);
    });

    it('código válido: ativa o canal', async () => {
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);
      const r = await handleStart(deps, 'chat-start-ok', code);
      expect(r.text).toMatch(/ativad/i);
    });

    it('código inválido: orienta pedir um novo', async () => {
      const r = await handleStart(deps, 'chat-start-bad', 'ZZZZZZZZ');
      expect(r.text).toMatch(/inv[áa]lido/i);
      expect(r.text).toMatch(/novo c[óo]digo/i);
    });
  });

  describe('foto do prato', () => {
    it('sem pareamento: nega e instrui parear (não registra)', async () => {
      const r = await handlePhoto(deps, 'chat-unpaired', IMAGE);
      expect(r.text).toMatch(/n[ãa]o est[áa] ativo/i);
    });

    it('pareado: estima, PERGUNTA a refeição e só grava após a resposta', async () => {
      const patientId = await pairNewChat('chat-photo');
      const { ask, confirm } = await logAndConfirm(deps, 'chat-photo', { photo: IMAGE, photoRef: 'tg-file-1' });

      // A estimativa aparece JUNTO da pergunta: o paciente precisa ver o que o
      // bot entendeu antes de classificar, senão classifica às cegas.
      expect(ask.text).toMatch(/kcal/);
      expect(ask.text).toMatch(/de que refei[çc][ãa]o/i);
      expect(ask.text).toContain('não substitui'); // disclaimer obrigatório (ADR-015)
      expect(ask.buttons?.flat()).toHaveLength(4);

      expect(confirm.text).toMatch(/registrei no seu almo/i);

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(620); // valor do FakeFoodEstimator

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.meal).toBe('almoco');
    });

    it('enquanto NÃO responde, o prato não entra na conta do dia', async () => {
      const patientId = await pairNewChat('chat-photo-pend');
      const ask = await handleUpdate(deps, { chatId: 'chat-photo-pend', photo: IMAGE, photoRef: 'f-p' });
      expect(ask?.buttons).toBeDefined();

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(0);
    });

    it('pareado com meta: mostra o quanto falta APÓS a confirmação', async () => {
      const patientId = await pairNewChat('chat-photo-goal');
      await setNutritionGoal(exec, patientId, userId, '2026-07-01', { kcal: 2000, protein: 150, carbs: 200, fat: 60 }, KEY);
      const { confirm } = await logAndConfirm(deps, 'chat-photo-goal', { photo: IMAGE });
      expect(confirm.text).toMatch(/faltam/i);
    });

    it('estimador indisponível (null): degrada com aviso, sem quebrar', async () => {
      await pairNewChat('chat-no-est');
      const depsNoEst: BotDeps = { ...deps, estimator: null };
      const r = await handlePhoto(depsNoEst, 'chat-no-est', IMAGE);
      expect(r.text).toMatch(/indispon[íi]vel/i);
    });
  });

  describe('legenda da foto e /corrigir', () => {
    it('foto com legenda: a descrição do paciente orienta a estimativa', async () => {
      await pairNewChat('chat-caption');
      const r = await handleUpdate(deps, {
        chatId: 'chat-caption',
        photo: IMAGE,
        photoRef: 'f-cap',
        caption: 'frango grelhado com arroz',
      });
      expect(r?.text).toContain('frango grelhado com arroz'); // itemsLabel do fake reflete a legenda
    });

    it('/corrigir: reestima a mesma foto e ATUALIZA a entrada (não duplica o consumo)', async () => {
      const patientId = await pairNewChat('chat-fix');
      await logAndConfirm(deps, 'chat-fix', { photo: IMAGE, photoRef: 'tg-file-fix' }); // 620 kcal (fake sem hint)

      const r = await handleCorrection(deps, 'chat-fix', 'era frango grelhado, não peixe');
      expect(r.text).toMatch(/ajustad/i);
      expect(r.text).toContain('era frango grelhado, não peixe'); // itemsLabel reflete a correção
      expect(r.text).toContain('não substitui'); // disclaimer segue presente (ADR-015)

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(580); // substituiu os 620 do registro original — não somou
    });

    it('/corrigir corrige a última entrada, preservando as anteriores do dia', async () => {
      const patientId = await pairNewChat('chat-fix-2x');
      await logAndConfirm(deps, 'chat-fix-2x', { photo: IMAGE, photoRef: 'tg-a' }); // 620
      await logAndConfirm(deps, 'chat-fix-2x', { photo: IMAGE, photoRef: 'tg-b' }); // 620
      await handleCorrection(deps, 'chat-fix-2x', 'era frango'); // última vira 580

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(620 + 580);
    });

    it('/corrigir sem texto: explica o uso', async () => {
      await pairNewChat('chat-fix-empty');
      const r = await handleCorrection(deps, 'chat-fix-empty', '');
      expect(r.text).toMatch(/\/corrigir/);
    });

    it('/corrigir sem prato registrado hoje: orienta enviar a foto primeiro', async () => {
      await pairNewChat('chat-fix-none');
      const r = await handleCorrection(deps, 'chat-fix-none', 'era frango');
      expect(r.text).toMatch(/n[ãa]o encontrei/i);
    });

    it('/corrigir sem photoRef salvo: pede o reenvio da foto com legenda', async () => {
      await pairNewChat('chat-fix-noref');
      await logAndConfirm(deps, 'chat-fix-noref', { photo: IMAGE }); // sem photoRef
      const r = await handleCorrection(deps, 'chat-fix-noref', 'era frango');
      expect(r.text).toMatch(/envie a foto novamente/i);
    });

    it('/corrigir sem pareamento: nega e instrui parear', async () => {
      const r = await handleCorrection(deps, 'chat-fix-unpaired', 'era frango');
      expect(r.text).toMatch(/n[ãa]o est[áa] ativo/i);
    });

    it('resposta da foto convida a corrigir (/corrigir descoberto no fluxo)', async () => {
      await pairNewChat('chat-fix-tip');
      const r = await handlePhoto(deps, 'chat-fix-tip', IMAGE, 'tg-tip');
      expect(r.text).toContain('/corrigir');
    });

    it('dispatcher roteia /corrigir', async () => {
      await pairNewChat('chat-fix-disp');
      await logAndConfirm(deps, 'chat-fix-disp', { photo: IMAGE, photoRef: 'f-d' });
      const r = await handleUpdate(deps, { chatId: 'chat-fix-disp', text: '/corrigir era frango' });
      expect(r?.text).toMatch(/ajustad/i);
    });
  });

  describe('/hoje e /meta', () => {
    it('/hoje: mostra o progresso do dia', async () => {
      await pairNewChat('chat-hoje');
      const r = await handleToday(deps, 'chat-hoje');
      expect(r.text).toMatch(/hoje/i);
    });

    it('/meta sem meta definida: informa (não inventa — ADR-015)', async () => {
      await pairNewChat('chat-meta-none');
      const r = await handleGoal(deps, 'chat-meta-none');
      expect(r.text).toMatch(/ainda n[ãa]o definiu/i);
    });

    it('/meta com meta: mostra os alvos', async () => {
      const patientId = await pairNewChat('chat-meta-ok');
      await setNutritionGoal(exec, patientId, userId, '2026-07-01', { kcal: 1800, protein: 140, carbs: 170, fat: 55 }, KEY);
      const r = await handleGoal(deps, 'chat-meta-ok');
      expect(r.text).toMatch(/1800/);
    });
  });

  describe('orientação por IA (12.8)', () => {
    it('com llm: acrescenta a frase de orientação e mantém o disclaimer', async () => {
      await pairNewChat('chat-ia');
      const depsIa: BotDeps = { ...deps, llm: new FakeLlmProvider() };
      // A orientação depende do progresso do DIA, que só existe após a
      // confirmação — por isso ela migrou para a resposta final.
      const { confirm: r } = await logAndConfirm(depsIa, 'chat-ia', { photo: IMAGE });
      expect(r.text).toContain('[aurelio]'); // marcador determinístico do FakeLlmProvider
      expect(r.text).toContain('não substitui'); // disclaimer segue presente (ADR-015)
    });

    it('/hoje com llm também traz orientação', async () => {
      await pairNewChat('chat-ia-hoje');
      const depsIa: BotDeps = { ...deps, llm: new FakeLlmProvider() };
      const r = await handleToday(depsIa, 'chat-ia-hoje');
      expect(r.text).toContain('[aurelio]');
    });

    it('sem llm: degrada para feedback factual (sem frase de IA), com disclaimer', async () => {
      await pairNewChat('chat-sem-ia');
      const r = await handlePhoto(deps, 'chat-sem-ia', IMAGE); // deps sem llm
      expect(r.text).not.toContain('[aurelio]');
      expect(r.text).toMatch(/kcal/);
      expect(r.text).toContain('não substitui');
    });

    it('llm que falha: degrada sem quebrar (mantém factual + disclaimer)', async () => {
      await pairNewChat('chat-ia-erro');
      const brokenLlm: ILlmProvider = {
        async complete() {
          throw new Error('llm indisponível');
        },
      };
      const depsErr: BotDeps = { ...deps, llm: brokenLlm };
      const r = await handlePhoto(depsErr, 'chat-ia-erro', IMAGE);
      expect(r.text).toMatch(/kcal/);
      expect(r.text).toContain('não substitui');
    });
  });

  describe('/comi — registro alimentar por texto (2026-07-24)', () => {
    it('gramas informados: calcula pela TACO, registra e soma no dia — SEM usar visão', async () => {
      const patientId = await pairNewChat('chat-comi');
      // estimator null prova que o caminho é determinístico (não passa pela visão)
      const r = await handleAte({ ...deps, estimator: null }, 'chat-comi', 'almoco 100g de arroz');

      expect(r.text).toMatch(/registrei/i);
      expect(r.text).toContain('tabela TACO');
      expect(r.text).toContain('não substitui'); // disclaimer segue obrigatório (ADR-015)

      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBeGreaterThan(0);

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.source).toBe('telegram-texto');
      expect(entry?.modelVersion).toMatch(/^taco-/); // proveniência: versão da TACO
      expect(entry?.values.confidence).toBe('high'); // quantidade explícita ⇒ alta
      expect(entry?.values.portionsEstimated).toBeUndefined();
    });

    it('vários itens numa mensagem', async () => {
      const patientId = await pairNewChat('chat-comi-multi');
      const r = await handleAte(deps, 'chat-comi-multi', 'almoco 100g de arroz, 150g de frango grelhado');
      expect(r.text).toContain('arroz');
      expect(r.text).toContain('frango');

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.values.itemsLabel).toContain('arroz');
    });

    // ── E16: precisão do alimento escolhido ──────────────────────────────
    // Os casos abaixo foram medidos ERRADOS em produção (2026-08-06), com o
    // paciente-piloto usando o bot para conduzir a dieta. Aqui eles são
    // exercitados ponta a ponta — do texto ao valor gravado no banco.
    it('"80g de frango grelhado" registra o PEITO, não o coração de galinha', async () => {
      const patientId = await pairNewChat('chat-e16-frango');
      await handleAte({ ...deps, estimator: null }, 'chat-e16-frango', 'almoco 80g de frango grelhado');

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      // Peito grelhado: 159 kcal e 32 g de proteína por 100 g ⇒ 80 g = ~127 kcal
      // e ~25,6 g. O coração (o match antigo) daria ~166 kcal e ~18 g — a
      // proteína, que é o número que o paciente persegue, vinha 30% menor.
      expect(entry?.values.kcal).toBeGreaterThan(115);
      expect(entry?.values.kcal).toBeLessThan(140);
      expect(entry?.values.protein).toBeGreaterThan(23);
      expect(entry?.values.fat).toBeLessThan(4); // coração daria ~9,7 g
    });

    it('"100g de arroz branco" registra arroz, não arroz carreteiro', async () => {
      const patientId = await pairNewChat('chat-e16-arroz');
      await handleAte({ ...deps, estimator: null }, 'chat-e16-arroz', 'almoco 100g de arroz branco');

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      // Arroz tipo 1 cozido: 128 kcal, 2,5 g P, 0,2 g G. O carreteiro (match
      // antigo) traz carne-seca junto: 154 kcal, 10,8 g P, 7,1 g G.
      expect(entry?.values.protein).toBeLessThan(5);
      expect(entry?.values.fat).toBeLessThan(2);
    });

    it('"30g de whey protein isolado" é registrado — a TACO não tem suplemento', async () => {
      const patientId = await pairNewChat('chat-e16-whey');
      const r = await handleAte({ ...deps, estimator: null }, 'chat-e16-whey', 'lanche 30g de whey protein isolado');

      // Antes desta rodada o bot respondia que não conseguia calcular.
      expect(r.text).toMatch(/registrei/i);
      expect(r.text).toContain('rótulos'); // procedência exata: não é da TACO

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.values.protein).toBeGreaterThan(20); // 30 g × 83% ≈ 25 g
      expect(entry?.values.kcal).toBeGreaterThan(90);
    });

    it('"200ml de leite desnatado" usa o leite LÍQUIDO, não o leite em pó', async () => {
      const patientId = await pairNewChat('chat-e16-leite');
      await handleAte({ ...deps, estimator: null }, 'chat-e16-leite', 'cafe 200ml de leite desnatado');

      // A TACO só analisou leite em PÓ (362 kcal/100 g); o líquido tem ~35.
      // 200 ml ⇒ ~70 kcal. Pelo leite em pó daria ~724 — 10×.
      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.values.kcal).toBeGreaterThan(50);
      expect(entry?.values.kcal).toBeLessThan(100);
    });

    it('"90g de macarrão" registra a massa COZIDA — o caso relatado pelo piloto', async () => {
      const patientId = await pairNewChat('chat-e16-macarrao');
      const r = await handleAte({ ...deps, estimator: null }, 'chat-e16-macarrao', 'almoco 90g de macarrao');

      // O piloto recebeu "não tenho macarrão" porque a TACO só tem massa CRUA
      // (371 kcal/100 g) — cozida absorve água e cai para ~158. 90 g ⇒ ~142 kcal.
      expect(r.text).toMatch(/registrei/i);

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.values.kcal).toBeGreaterThan(120);
      expect(entry?.values.kcal).toBeLessThan(165);
    });

    it('alimento que não é comida não vira registro (água)', async () => {
      const patientId = await pairNewChat('chat-e16-agua');
      const r = await handleAte({ ...deps, estimator: null }, 'chat-e16-agua', 'almoco 500ml de agua');

      // Antes caía em "Coco, água de". O bot é só de ALIMENTAÇÃO desde
      // 2026-07-24 — água não entra na contagem nem como registro de 0 kcal.
      expect(r.text).toMatch(/não entra na contagem/i);
      const entries = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entries).toHaveLength(0);
    });

    it('"creatina" entra com ZERO calorias, nunca como proteína', async () => {
      const patientId = await pairNewChat('chat-e16-creatina');
      await handleAte({ ...deps, estimator: null }, 'chat-e16-creatina', 'lanche 5g de creatina');

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      // Bases públicas trazem creatina com ~88 g de "proteína" por 100 g
      // (artefato de Kjeldahl). Isso inflaria a aderência proteica do plano
      // inteiro com proteína que não existe.
      expect(entry?.values.kcal).toBe(0);
      expect(entry?.values.protein).toBe(0);
    });

    it('sem quantidade: assume porção, SINALIZA na resposta e no registro', async () => {
      const patientId = await pairNewChat('chat-comi-sem-qtd');
      const r = await handleAte(deps, 'chat-comi-sem-qtd', 'almoco arroz');
      expect(r.text).toMatch(/não informou a quantidade/i);
      expect(r.text).toContain('~estimada');

      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry?.values.portionsEstimated).toBe(true);
      expect(entry?.values.confidence).not.toBe('high');
    });

    it('nada reconhecível na TACO: NÃO registra e orienta', async () => {
      const patientId = await pairNewChat('chat-comi-nada');
      const r = await handleAte(deps, 'chat-comi-nada', 'xyzabc qwerty');
      expect(r.text).toMatch(/não encontrei|não registrei/i);

      const entries = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entries).toHaveLength(0);
    });

    it('sem argumento: explica o formato', async () => {
      await pairNewChat('chat-comi-vazio');
      const r = await handleAte(deps, 'chat-comi-vazio', '');
      expect(r.text).toMatch(/quantidades/i);
    });

    it('canal não pareado: exige vínculo antes de registrar', async () => {
      const r = await handleAte(deps, 'chat-comi-sem-par', '100g de arroz');
      expect(r.text).toMatch(/não está ativo/i);
    });

    it('foto continua funcionando junto com o texto (os dois caminhos coexistem)', async () => {
      const patientId = await pairNewChat('chat-comi-e-foto');
      await handleAte(deps, 'chat-comi-e-foto', 'almoco 100g de arroz');
      await logAndConfirm(deps, 'chat-comi-e-foto', { photo: IMAGE, photoRef: 'tg-coexiste' }, 'jantar');

      const entries = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.source).sort()).toEqual(['telegram', 'telegram-texto']);
    });
  });

  describe('exclusão pelo médico (soft-delete, migration 0021)', () => {
    it('registro excluído sai das somas e das listagens, mas a linha permanece', async () => {
      const patientId = await pairNewChat('chat-del');
      await handleAte(deps, 'chat-del', 'almoco 100g de arroz');
      const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(entry).toBeDefined();

      await softDeleteFoodLogEntry(exec, patientId, entry!.id);

      expect(await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY)).toHaveLength(0);
      const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
      expect(progress.consumed.kcal).toBe(0);

      // trilha/retenção (CJ-2): a linha continua no banco, marcada
      const raw = await exec.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM food_log_entry WHERE id = $1',
        [entry!.id],
      );
      expect(raw.rows[0]?.deleted_at).not.toBeNull();
    });

    it('excluir registro de outro paciente falha (isolamento)', async () => {
      const patientA = await pairNewChat('chat-del-a');
      await handleAte(deps, 'chat-del-a', 'almoco 100g de arroz');
      const [entry] = await listFoodLogByDay(exec, patientA, '2026-07-01', -180, KEY);
      const patientB = await insertPatient(exec, userId);

      await expect(softDeleteFoodLogEntry(exec, patientB, entry!.id)).rejects.toThrow(/não encontrado/i);
    });
  });

  describe('handleUpdate — dispatcher', () => {
    it('roteia foto, /hoje, /meta, texto desconhecido e vazio', async () => {
      await pairNewChat('chat-disp');

      const foto = await handleUpdate(deps, { chatId: 'chat-disp', photo: IMAGE, photoRef: 'f1' });
      expect(foto?.text).toMatch(/kcal/);

      const hoje = await handleUpdate(deps, { chatId: 'chat-disp', text: '/hoje' });
      expect(hoje?.text).toMatch(/hoje/i);

      const meta = await handleUpdate(deps, { chatId: 'chat-disp', text: '/meta' });
      expect(meta?.text).toMatch(/meta|ainda n[ãa]o definiu/i);

      const help = await handleUpdate(deps, { chatId: 'chat-disp', text: 'oi tudo bem?' });
      expect(help?.text).toMatch(/n[ãa]o entendi/i);

      const vazio = await handleUpdate(deps, { chatId: 'chat-disp' });
      expect(vazio).toBeNull();
    });

    it('aceita comandos com menção (/comando@Bot — forma usada em grupos)', async () => {
      // Pareia o "grupo" via /start@Bot CÓDIGO — o @Bot não pode vazar no argumento.
      const patientId = await insertPatient(exec, userId);
      const code = await createPairingCode(exec, patientId, userId);
      const start = await handleUpdate(deps, { chatId: 'chat-group', text: `/start@RafaNutriBot ${code}` });
      expect(start?.text).toMatch(/ativado/i);

      const hoje = await handleUpdate(deps, { chatId: 'chat-group', text: '/hoje@RafaNutriBot' });
      expect(hoje?.text).toMatch(/hoje/i);

      const meta = await handleUpdate(deps, { chatId: 'chat-group', text: '/meta@RafaNutriBot' });
      expect(meta?.text).toMatch(/meta|ainda n[ãa]o definiu/i);

      // /start@Bot sem código = boas-vindas (não confunde a menção com um código)
      const welcome = await handleUpdate(deps, { chatId: 'chat-group-2', text: '/start@RafaNutriBot' });
      expect(welcome?.text).toMatch(/c[óo]digo de\s*v[íi]nculo/i);
    });
  });
});

describe('Pergunta da refeição (E16 Fase 2)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let deps: BotDeps;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'fase2@nutrimed.test');
    deps = {
      db: exec,
      key: KEY,
      estimator: new FakeFoodEstimator(),
      now: NOW,
      tzOffsetMinutes: -180,
      downloadPhoto: async () => IMAGE,
    };
  });

  afterAll(async () => {
    await db.close();
  });

  async function pairNewChat(chatId: string): Promise<string> {
    const patientId = await insertPatient(exec, userId);
    const code = await createPairingCode(exec, patientId, userId);
    await redeemPairingCode(exec, chatId, code);
    return patientId;
  }

  it('o atalho evita a pergunta: "/comi almoço ..." grava direto', async () => {
    // "Perguntar sempre" vale quando o paciente NÃO disse. Se ele já falou a
    // refeição, perguntar de novo seria ignorá-lo.
    const patientId = await pairNewChat('f2-atalho');
    const r = await handleAte(deps, 'f2-atalho', 'almoço 100g de arroz');

    expect(r.buttons).toBeUndefined();
    expect(r.text).toMatch(/registrei no seu almo/i);

    const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
    expect(entry?.meal).toBe('almoco');
  });

  it('legenda da foto com a refeição também pula a pergunta', async () => {
    const patientId = await pairNewChat('f2-legenda');
    const r = await handleUpdate(deps, {
      chatId: 'f2-legenda',
      photo: IMAGE,
      photoRef: 'f-leg',
      caption: 'jantar: frango grelhado',
    });
    expect(r?.buttons).toBeUndefined();

    const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
    expect(entry?.meal).toBe('jantar');
    // o resto da legenda continua servindo de dica para a visão
    expect(entry?.values.itemsLabel).toContain('frango grelhado');
  });

  it('/refeicao é o fallback do botão e aplica ao pendente mais antigo', async () => {
    const patientId = await pairNewChat('f2-comando');
    await handleUpdate(deps, { chatId: 'f2-comando', photo: IMAGE, photoRef: 'f-cmd' });

    const r = await handleMealCommand(deps, 'f2-comando', 'janta');
    expect(r.text).toMatch(/registrei no seu jantar/i);

    const [entry] = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
    expect(entry?.meal).toBe('jantar');
  });

  it('/refeicao sem pendente avisa em vez de falhar', async () => {
    await pairNewChat('f2-sem-pend');
    const r = await handleMealCommand(deps, 'f2-sem-pend', 'almoco');
    expect(r.text).toMatch(/nenhum registro esperando/i);
  });

  it('/refeicao com termo desconhecido orienta, e NÃO chuta', async () => {
    await pairNewChat('f2-termo-ruim');
    await handleUpdate(deps, { chatId: 'f2-termo-ruim', photo: IMAGE });
    const r = await handleMealCommand(deps, 'f2-termo-ruim', 'sobremesa');
    expect(r.text).toMatch(/não entendi a refeição/i);
  });

  it('duplo toque no mesmo botão não duplica o consumo', async () => {
    const patientId = await pairNewChat('f2-duplo');
    const ask = await handleUpdate(deps, { chatId: 'f2-duplo', photo: IMAGE, photoRef: 'f-dup' });
    const botao = ask!.buttons!.flat()[0]!;

    await handleUpdate(deps, { chatId: 'f2-duplo', callbackData: botao.data, callbackId: 'cb-a' });
    const segundo = await handleUpdate(deps, { chatId: 'f2-duplo', callbackData: botao.data, callbackId: 'cb-b' });

    expect(segundo?.text).toMatch(/já foi confirmado|não está mais pendente|expirou/i);
    const progress = await sumFoodLogForDay(exec, patientId, '2026-07-01', -180, KEY);
    expect(progress.consumed.kcal).toBe(620); // uma vez só
  });

  it('dois pratos pendentes não se confundem — cada botão resolve o seu', async () => {
    const patientId = await pairNewChat('f2-dois');
    const a = await handleUpdate(deps, { chatId: 'f2-dois', photo: IMAGE, photoRef: 'f-1' });
    const b = await handleUpdate(deps, { chatId: 'f2-dois', photo: IMAGE, photoRef: 'f-2' });
    expect(a!.buttons![0]![0]!.data).not.toBe(b!.buttons![0]![0]!.data);

    // a 2ª pergunta identifica QUAL prato, senão o paciente não sabe o que responde
    expect(b!.text).toMatch(/das \d{2}h\d{2}/);

    await handleUpdate(deps, { chatId: 'f2-dois', callbackData: a!.buttons!.flat()[0]!.data, callbackId: 'x' });
    await handleUpdate(deps, { chatId: 'f2-dois', callbackData: b!.buttons!.flat()[2]!.data, callbackId: 'y' });

    const entries = await listFoodLogByDay(exec, patientId, '2026-07-01', -180, KEY);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.meal).sort()).toEqual(['cafe_da_manha', 'jantar']);
  });

  it('no 4º prato sem resposta o bot NÃO chama o estimador', async () => {
    // A visão custa por chamada. Acumular perguntas sem resposta é sinal de
    // conversa travada, não de uso normal (lição do vazamento de 2026-07-24).
    await pairNewChat('f2-teto');
    let chamadas = 0;
    const contando: BotDeps = {
      ...deps,
      estimator: {
        modelVersion: 'fake',
        estimate: async (...args: Parameters<FakeFoodEstimator['estimate']>) => {
          chamadas += 1;
          return new FakeFoodEstimator().estimate(...args);
        },
      },
    };

    for (let i = 0; i < 3; i += 1) {
      await handleUpdate(contando, { chatId: 'f2-teto', photo: IMAGE, photoRef: `f-${i}` });
    }
    expect(chamadas).toBe(3);

    const quarta = await handleUpdate(contando, { chatId: 'f2-teto', photo: IMAGE, photoRef: 'f-3' });
    expect(chamadas).toBe(3); // NÃO chamou de novo
    expect(quarta?.text).toMatch(/esperando você dizer/i);
  });

  it('/hoje avisa do pendente e reenvia os botões', async () => {
    // Sem isto o paciente vê um /hoje que não bate com o que enviou e conclui
    // que o bot perdeu a foto.
    await pairNewChat('f2-hoje');
    await handleUpdate(deps, { chatId: 'f2-hoje', photo: IMAGE, photoRef: 'f-h' });

    const r = await handleToday(deps, 'f2-hoje');
    expect(r.text).toMatch(/esperando/i);
    expect(r.text).toMatch(/não entrou na conta/i);
    expect(r.buttons?.flat()).toHaveLength(4);
  });

  it('o callback_data cabe no limite de 64 bytes do Telegram', async () => {
    await pairNewChat('f2-bytes');
    const ask = await handleUpdate(deps, { chatId: 'f2-bytes', photo: IMAGE });
    for (const b of ask!.buttons!.flat()) {
      expect(Buffer.byteLength(b.data, 'utf8')).toBeLessThanOrEqual(64);
    }
  });

  it('botão de chat não pareado não vaza nada', async () => {
    const r = await handleUpdate(deps, {
      chatId: 'f2-nao-pareado',
      callbackData: 'm:00000000000000000000000000000000:a',
      callbackId: 'cb',
    });
    expect(r?.text).toMatch(/não está ativo/i);
  });
});
