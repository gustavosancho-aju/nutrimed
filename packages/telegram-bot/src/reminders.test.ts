import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor, pgliteExecutor } from '@nutrimed/db';
import {
  addFoodLogEntry,
  addPendingFoodEntry,
  setNutritionGoal,
  claimReminder,
  type Meal,
} from '@nutrimed/patients';
import { createPairingCode, redeemPairingCode, setRemindersEnabled, areRemindersEnabled } from '@nutrimed/telegram-link';
import { FakeFoodEstimator } from '@nutrimed/food-vision';
import { handleUpdate, type BotDeps } from './bot';
import {
  BELOW_GOAL_RATIO,
  QUIET_HOURS,
  missingMeals,
  planReminders,
  runReminderTick,
  type PlannedReminder,
  type ReminderDeps,
} from './reminders';

const KEY = randomBytes(32);
const BR = -180;
const DIA = '2026-07-01';

/** Instante UTC correspondente a uma hora LOCAL (BR) do dia de teste. */
function localAt(h: number, m = 0): Date {
  return new Date(Date.parse(`${DIA}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - BR * 60_000);
}

describe('Lembretes proativos (E16 Fase 3)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let deps: ReminderDeps;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const u = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      ['lembrete@nutrimed.test', 'Dra. Demo', 'x'],
    );
    userId = u.rows[0]!.id;
    deps = {
      db: exec,
      key: KEY,
      estimator: new FakeFoodEstimator(),
      tzOffsetMinutes: BR,
    } as BotDeps;
  });

  afterAll(async () => {
    await db.close();
  });

  /** Paciente com canal ativo. `reminders` liga o opt-in; `chatType` simula grupo. */
  async function novoPaciente(
    chatId: string,
    opts: { reminders?: boolean; chatType?: string; goalKcal?: number } = {},
  ): Promise<string> {
    const p = await exec.query<{ id: string }>(
      'INSERT INTO patient (user_id, name_enc) VALUES ($1,$2) RETURNING id',
      [userId, 'enc'],
    );
    const patientId = p.rows[0]!.id;
    const code = await createPairingCode(exec, patientId, userId);
    await redeemPairingCode(exec, chatId, code, opts.chatType);
    if (opts.reminders) await setRemindersEnabled(exec, patientId, true);
    if (opts.goalKcal) {
      await setNutritionGoal(
        exec, patientId, userId, DIA,
        { kcal: opts.goalKcal, protein: 100, carbs: 200, fat: 60 }, KEY,
      );
    }
    return patientId;
  }

  async function registrar(patientId: string, kcal: number, meal: Meal, hora = 12): Promise<void> {
    await addFoodLogEntry(
      exec, patientId,
      { eatenAt: localAt(hora), values: { kcal, protein: 10, carbs: 20, fat: 5 }, meal },
      KEY,
    );
  }

  describe('quando o tick NÃO faz nada', () => {
    it('fora das janelas não consulta nem planeja', async () => {
      await novoPaciente('lb-fora', { reminders: true, goalKcal: 2000 });
      expect(await planReminders(deps, localAt(11))).toEqual([]);
      expect(await planReminders(deps, localAt(19))).toEqual([]);
    });

    it('respeita o piso de silêncio (madrugada), mesmo com janela mal configurada', async () => {
      // Piso rígido = rede de segurança contra bug de fuso, não uma feature.
      const madrugada: ReminderDeps = {
        ...deps,
        windows: { belowGoal: [0, 24 * 60], missingMeal: [0, 24 * 60] },
      };
      expect(await planReminders(madrugada, localAt(3))).toEqual([]);
      expect(QUIET_HOURS.from).toBe(7 * 60);
    });

    it('paciente SEM opt-in não recebe nada (default é false)', async () => {
      // Mensagem proativa é finalidade nova: ninguém é migrado para "sim".
      await novoPaciente('lb-optout', { goalKcal: 2000 });
      const planos = await planReminders(deps, localAt(16, 10));
      expect(planos.map((p) => p.chatId)).not.toContain('lb-optout');
    });

    it('GRUPO nunca recebe mensagem proativa', async () => {
      // Aderência num chat com nutrólogo e nutricionista é divulgação a
      // terceiros que o paciente não iniciou.
      await novoPaciente('-100200300', { reminders: true, goalKcal: 2000, chatType: 'supergroup' });
      const planos = await planReminders(deps, localAt(16, 10));
      expect(planos.map((p) => p.chatId)).not.toContain('-100200300');
    });

    it('SEM meta definida não existe "abaixo da meta"', async () => {
      // Inventar um alvo é exatamente o que o ADR-015 proíbe.
      await novoPaciente('lb-sem-meta', { reminders: true });
      const planos = await planReminders(deps, localAt(16, 10));
      expect(planos.map((p) => p.chatId)).not.toContain('lb-sem-meta');
    });

    it('quem já bateu metade da meta às 16h não é cutucado', async () => {
      const id = await novoPaciente('lb-ok', { reminders: true, goalKcal: 2000 });
      await registrar(id, 1200, 'almoco');
      const planos = await planReminders(deps, localAt(16, 10));
      expect(planos.map((p) => p.chatId)).not.toContain('lb-ok');
    });
  });

  describe('16h — consumo abaixo da meta', () => {
    it('cutuca quem está bem abaixo, citando NÚMEROS e a meta do nutricionista', async () => {
      const id = await novoPaciente('lb-baixo', { reminders: true, goalKcal: 2000 });
      await registrar(id, 400, 'cafe_da_manha', 8);

      const plano = (await planReminders(deps, localAt(16, 10))).find((p) => p.chatId === 'lb-baixo');
      expect(plano).toBeDefined();
      expect(plano!.kind).toBe('abaixo-da-meta-16h');
      expect(plano!.text).toMatch(/400/);
      expect(plano!.text).toMatch(/2000/);
      expect(plano!.text).toMatch(/seu nutricionista/i);
      expect(plano!.text).toMatch(/\/silenciar/);
    });

    it('quem não registrou NADA recebe a versão mais leve, sem números', async () => {
      // Listar faltas para quem não registrou nada lê como sermão.
      await novoPaciente('lb-zero', { reminders: true, goalKcal: 2000 });
      const plano = (await planReminders(deps, localAt(16, 30))).find((p) => p.chatId === 'lb-zero');
      expect(plano!.text).toMatch(/ainda não chegou nenhum registro/i);
      expect(plano!.text).not.toMatch(/\d{3,}/); // sem kcal nem meta
    });

    it('o limiar é metade da meta e está exportado (não é número mágico)', () => {
      expect(BELOW_GOAL_RATIO).toBe(0.5);
    });
  });

  describe('22h — refeição sem registro', () => {
    it('cita NO MÁXIMO UMA refeição faltante, não a lista toda', async () => {
      // Uma lista de faltas é um boletim de notas.
      const id = await novoPaciente('lb-falta', { reminders: true, goalKcal: 2000 });
      await registrar(id, 500, 'jantar', 20); // faltam café e almoço

      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-falta');
      expect(plano!.kind).toBe('refeicao-faltante-22h');
      expect(plano!.text).toMatch(/café da manhã/i);
      expect(plano!.text).not.toMatch(/almoço/i);
    });

    it('quem registrou as 3 esperadas NÃO é cobrado — recebe reconhecimento', async () => {
      // Comportamento mudou a pedido do piloto (2026-08-06): antes o dia
      // completo era silêncio. Silêncio como recompensa por fazer certo é um
      // sinal fraco; o reconhecimento da ADESÃO é o que reforça o hábito.
      const id = await novoPaciente('lb-completo', { reminders: true, goalKcal: 2000 });
      await registrar(id, 400, 'cafe_da_manha', 8);
      await registrar(id, 700, 'almoco', 12);
      await registrar(id, 600, 'jantar', 20);

      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-completo');
      expect(plano!.kind).toBe('dia-completo-22h');
      expect(plano!.text).not.toMatch(/não chegou|faltou|falta/i);
    });

    it('dia completo: comemora o REGISTRO, nunca o resultado clínico', async () => {
      // A distinção é fina e é toda a diferença: "você registrou as 3 refeições"
      // é adesão ao diário (comportamento com o bot, verificável, não clínico).
      // "você bateu a meta de calorias" seria avaliação de conduta alimentar sem
      // médico no circuito — a fronteira do CJ-4.
      const id = await novoPaciente('lb-completo-msg', { reminders: true, goalKcal: 2000 });
      await registrar(id, 400, 'cafe_da_manha', 8);
      await registrar(id, 700, 'almoco', 12);
      await registrar(id, 600, 'jantar', 20);

      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-completo-msg');
      expect(plano).toBeDefined();
      expect(plano!.kind).toBe('dia-completo-22h');
      expect(plano!.text).toMatch(/dia completo/i);
      expect(plano!.text).toMatch(/café da manhã.*almoço.*jantar/i);

      // NÃO cita meta, kcal, nem julga o que foi comido
      expect(plano!.text).not.toMatch(/meta|kcal|caloria/i);
      expect(plano!.text).not.toMatch(/ótima|excelente escolha|saudável|equilibrad/i);
    });

    it('não parabeniza logo depois de ter cobrado — soaria vazio', async () => {
      // Se o "faltou o jantar" saiu às 21h50 e o paciente registrou às 22h,
      // mandar "obrigado por manter o diário em dia" 10 min depois é hollow.
      const id = await novoPaciente('lb-cobrado', { reminders: true, goalKcal: 2000 });
      await registrar(id, 400, 'cafe_da_manha', 8);
      await registrar(id, 700, 'almoco', 12);

      // 1º tick: cobra o jantar
      const enviados: string[] = [];
      await runReminderTick(deps, async (c) => { enviados.push(c); return true; }, localAt(21, 50));
      expect(enviados).toContain('lb-cobrado');

      // paciente registra o jantar e o tick roda de novo na MESMA janela
      await registrar(id, 600, 'jantar', 22);
      const planos = await planReminders(deps, localAt(22, 10));
      expect(planos.map((p) => p.chatId)).not.toContain('lb-cobrado');
    });

    it('quem não registrou nada não recebe parabéns', async () => {
      await novoPaciente('lb-nada-parabens', { reminders: true, goalKcal: 2000 });
      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-nada-parabens');
      expect(plano!.kind).toBe('refeicao-faltante-22h');
      expect(plano!.text).not.toMatch(/dia completo|parabéns/i);
    });

    it('LANCHE nunca é cobrado — cobrar seria inventar uma falta', () => {
      expect(missingMeals(['cafe_da_manha', 'almoco', 'jantar'])).toEqual([]);
      expect(missingMeals([])).not.toContain('lanche');
    });

    it('pendente sem resposta tem PRIORIDADE e vem com os botões', async () => {
      // É mais preciso (o prato já foi estimado e pago) e resolve a lacuna sem
      // o paciente digitar nada de novo.
      const id = await novoPaciente('lb-pend', { reminders: true, goalKcal: 2000 });
      await addPendingFoodEntry(
        exec, id, 'lb-pend',
        { eatenAt: localAt(12, 47), values: { kcal: 620, protein: 42, carbs: 68, fat: 18, itemsLabel: 'arroz, feijão' } },
        KEY, localAt(23),
      );

      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-pend');
      expect(plano!.text).toMatch(/de que refeição foi o prato/i);
      expect(plano!.text).toMatch(/12h47/);
      expect(plano!.buttons?.flat()).toHaveLength(4);
    });
  });

  describe('idempotência do envio', () => {
    it('o mesmo lembrete não sai duas vezes no mesmo dia', async () => {
      await novoPaciente('lb-idem', { reminders: true, goalKcal: 2000 });
      const enviados: string[] = [];
      const push = async (chatId: string): Promise<boolean> => {
        enviados.push(chatId);
        return true;
      };

      await runReminderTick(deps, push, localAt(16, 5));
      await runReminderTick(deps, push, localAt(16, 35)); // outro tick, MESMA janela

      expect(enviados.filter((c) => c === 'lb-idem')).toHaveLength(1);
    });

    it('claim já usado bloqueia o envio (a trava é do banco, não da memória)', async () => {
      const id = await novoPaciente('lb-claim', { reminders: true, goalKcal: 2000 });
      // simula um envio anterior, como se outro processo tivesse mandado
      expect(await claimReminder(exec, id, 'abaixo-da-meta-16h', DIA, 'lb-claim')).toBe(true);
      expect(await claimReminder(exec, id, 'abaixo-da-meta-16h', DIA, 'lb-claim')).toBe(false);

      const enviados: string[] = [];
      await runReminderTick(deps, async (c) => { enviados.push(c); return true; }, localAt(16, 5));
      expect(enviados).not.toContain('lb-claim');
    });

    it('falha no envio aciona onBlocked (403 = paciente bloqueou o bot)', async () => {
      await novoPaciente('lb-403', { reminders: true, goalKcal: 2000 });
      const bloqueados: string[] = [];
      await runReminderTick(
        deps,
        async () => false, // Bot API recusou
        localAt(16, 5),
        async (patientId) => { bloqueados.push(patientId); },
      );
      expect(bloqueados.length).toBeGreaterThan(0);
    });

    it('o tick nunca lança, mesmo se o envio explodir', async () => {
      await novoPaciente('lb-boom', { reminders: true, goalKcal: 2000 });
      await expect(
        runReminderTick(deps, async () => { throw new Error('rede caiu'); }, localAt(16, 5)),
      ).resolves.toBeDefined();
    });
  });

  describe('copy — nenhuma culpa, nenhuma prescrição', () => {
    /**
     * Mesmo teste que o E15 já aplica à frase de cobertura. Aqui ele vale para
     * TODAS as mensagens proativas, porque elas saem sem ninguém revisando.
     */
    const PROIBIDO =
      /fraca|ruim|falhou|falhando|deveria|precisa comer|coma |errado|insuficiente|péssim|vergonha|desculpa|preguiç/i;

    async function todasAsMensagens(): Promise<string[]> {
      const textos: string[] = [];
      const id = await novoPaciente('lb-copy', { reminders: true, goalKcal: 2000 });
      await registrar(id, 300, 'cafe_da_manha', 8);
      for (const t of [localAt(16, 10), localAt(22, 0)]) {
        for (const p of await planReminders(deps, t)) textos.push(p.text);
      }
      const zero = await novoPaciente('lb-copy-zero', { reminders: true, goalKcal: 2000 });
      expect(zero).toBeTruthy();
      for (const t of [localAt(16, 10), localAt(22, 0)]) {
        for (const p of await planReminders(deps, t)) textos.push(p.text);
      }
      return textos;
    }

    it('nenhuma mensagem contém linguagem de culpa ou prescrição', async () => {
      const textos = await todasAsMensagens();
      expect(textos.length).toBeGreaterThan(0);
      for (const t of textos) {
        expect(t, `linguagem proibida em: ${t}`).not.toMatch(PROIBIDO);
      }
    });

    it('o sujeito é o REGISTRO, nunca o paciente', async () => {
      // "não recebi o registro do café da manhã", jamais "você não tomou café".
      // O bot não sabe se o paciente comeu, e essa humildade é a defesa.
      for (const t of await todasAsMensagens()) {
        expect(t).not.toMatch(/você não (comeu|tomou|almoçou|jantou)/i);
      }
    });

    it('reconhece o REGISTRO, mas nunca julga a escolha alimentar', async () => {
      // A regra 7 é o que permite o tom acolhedor sem virar avaliação clínica:
      // agradecer por manter o diário fala do comportamento com o BOT; elogiar
      // ou criticar o que a pessoa comeu é juízo sobre conduta, sem médico no
      // circuito — a fronteira do CJ-4.
      const id = await novoPaciente('lb-tom', { reminders: true, goalKcal: 2000 });
      await registrar(id, 400, 'cafe_da_manha', 8);
      await registrar(id, 700, 'almoco', 12);

      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-tom');
      // reconhece o que foi registrado
      expect(plano!.text).toMatch(/obrigado|vi que voc[êe] registrou/i);
      expect(plano!.text).toMatch(/café da manhã/i);
      // e NÃO opina sobre a comida
      expect(plano!.text).not.toMatch(/ótima escolha|bem alimentad|saudável|equilibrad|leve demais|pesad/i);
    });

    it('sem nada registrado, não finge reconhecimento', async () => {
      // "Obrigado por manter em dia" para quem não registrou nada seria falso e
      // soaria irônico.
      await novoPaciente('lb-tom-zero', { reminders: true, goalKcal: 2000 });
      const plano = (await planReminders(deps, localAt(22, 0))).find((p) => p.chatId === 'lb-tom-zero');
      expect(plano!.text).not.toMatch(/obrigado/i);
    });

    it('toda mensagem proativa oferece a saída', async () => {
      for (const t of await todasAsMensagens()) {
        expect(t, `sem /silenciar: ${t}`).toMatch(/\/silenciar/);
      }
    });

    it('não há gamificação: sem streak, sem ❌, sem ⚠️', async () => {
      // ALTERNÂNCIA, não classe de caracteres: `[❌⚠️]` inclui o seletor de
      // variação U+FE0F como membro solto, e aí o `ℹ️` do disclaimer casa por
      // tabela — o teste reprovava a própria mensagem correta.
      for (const t of await todasAsMensagens()) {
        // 'parabéns' SAIU da lista: comemorar a ADESÃO AO DIÁRIO é permitido (regra 7).
        // O que continua proibido é comemorar RESULTADO CLÍNICO — ver o teste
        // 'nunca comemora resultado clínico' abaixo.
        expect(t).not.toMatch(/❌|⚠|sequência|streak|meta batida|dias seguidos/i);
      }
    });
  });
});

/** Só para o TS não reclamar do tipo importado mas usado indiretamente. */
export type _Planned = PlannedReminder;

describe('/silenciar e /lembretes — oposição do titular (LGPD art. 18)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let deps: BotDeps;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const u = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      ['silenciar@nutrimed.test', 'Dra. Demo', 'x'],
    );
    userId = u.rows[0]!.id;
    deps = { db: exec, key: KEY, estimator: null, tzOffsetMinutes: BR };
  });

  afterAll(async () => {
    await db.close();
  });

  async function parear(chatId: string): Promise<string> {
    const p = await exec.query<{ id: string }>(
      'INSERT INTO patient (user_id, name_enc) VALUES ($1,$2) RETURNING id',
      [userId, 'enc'],
    );
    const patientId = p.rows[0]!.id;
    const code = await createPairingCode(exec, patientId, userId);
    await redeemPairingCode(exec, chatId, code, 'private');
    return patientId;
  }

  it('o PACIENTE desliga sozinho, sem depender do médico', async () => {
    // É o que a LGPD exige: o titular precisa conseguir se opor sem pedir a
    // outra pessoa. O toggle da ficha é outra camada, com outro dono.
    const id = await parear('sil-1');
    await setRemindersEnabled(exec, id, true);
    expect(await areRemindersEnabled(exec, id)).toBe(true);

    const r = await handleUpdate(deps, { chatId: 'sil-1', text: '/silenciar' });
    expect(r?.text).toMatch(/não te mando mais lembretes/i);
    expect(await areRemindersEnabled(exec, id)).toBe(false);
  });

  it('e religa quando quiser', async () => {
    const id = await parear('sil-2');
    await handleUpdate(deps, { chatId: 'sil-2', text: '/silenciar' });
    const r = await handleUpdate(deps, { chatId: 'sil-2', text: '/lembretes' });
    expect(r?.text).toMatch(/religados/i);
    expect(await areRemindersEnabled(exec, id)).toBe(true);
  });

  it('funciona com o sufixo @bot (forma de grupo)', async () => {
    const id = await parear('sil-3');
    await setRemindersEnabled(exec, id, true);
    await handleUpdate(deps, { chatId: 'sil-3', text: '/silenciar@RafaNutriBot' });
    expect(await areRemindersEnabled(exec, id)).toBe(false);
  });

  it('a mensagem de silenciar não culpa nem insiste', async () => {
    const id = await parear('sil-4');
    await setRemindersEnabled(exec, id, true);
    const r = await handleUpdate(deps, { chatId: 'sil-4', text: '/silenciar' });
    expect(r!.text).not.toMatch(/tem certeza|mas |perde|recomendo que/i);
    expect(await areRemindersEnabled(exec, id)).toBe(false);
  });

  it('chat não pareado não muda nada', async () => {
    const r = await handleUpdate(deps, { chatId: 'sil-desconhecido', text: '/silenciar' });
    expect(r?.text).toMatch(/não está ativo/i);
  });
});
