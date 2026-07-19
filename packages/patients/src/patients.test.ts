import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@nutrimed/db';
import { getAuditTrail } from '@nutrimed/audit';
import {
  computeAge,
  createPatient,
  updatePatient,
  loadPatient,
  listPatients,
  countPatients,
  addBodyComposition,
  listBodyComposition,
  addLabExam,
  listLabExam,
  updateBodyComposition,
  updateLabExam,
  softDeleteBodyComposition,
  softDeleteLabExam,
  setCustomExamDefs,
  loadCustomExamDefs,
  setBodyGoal,
  loadCurrentBodyGoal,
} from './patients';


const KEY = randomBytes(32);

async function insertUser(exec: SqlExecutor, email: string): Promise<string> {
  const res = await exec.query<{ id: string }>(
    'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Dra. Demo', 'x'],
  );
  return res.rows[0]!.id;
}

describe('Patient Service (E11 — 11.2)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    userId = await insertUser(exec, 'medico@nutrimed.test');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('CRUD de paciente — cifrado e auditado (NFR9/NFR10)', () => {
    it('cria cifrado (ilegível no storage), carrega decifrado e audita patient-create', async () => {
      const patientId = await createPatient(
        exec,
        userId,
        { name: 'Carla Mendes', phone: '+5511999990000', birthDate: '1990-02-15', goal: 'Perder 8kg' },
        KEY,
      );

      const raw = await exec.query<{ name_enc: string; phone_enc: string }>(
        'SELECT name_enc, phone_enc FROM patient WHERE id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.name_enc).not.toContain('Carla');
      expect(raw.rows[0]!.phone_enc).not.toContain('5511');

      const patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.name).toBe('Carla Mendes');
      expect(patient!.phone).toBe('+5511999990000');
      expect(patient!.birthDate).toBe('1990-02-15');
      expect(patient!.goal).toBe('Perder 8kg');

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'patient-create' && e.modelVersion === 'human-edit')).toBe(true);
    });

    it('atualiza os dados e audita patient-edit', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Nome Antigo' }, KEY);
      await updatePatient(exec, patientId, { name: 'Nome Novo', goal: 'Manter peso' }, KEY);

      const patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.name).toBe('Nome Novo');
      expect(patient!.goal).toBe('Manter peso');

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'patient-edit')).toBe(true);
    });

    it('campos opcionais ausentes ⇒ null (sem placeholder cifrado)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Só Nome' }, KEY);
      const raw = await exec.query<{
        phone_enc: string | null;
        goal_enc: string | null;
        profession_enc: string | null;
      }>('SELECT phone_enc, goal_enc, profession_enc FROM patient WHERE id = $1', [patientId]);
      expect(raw.rows[0]!.phone_enc).toBeNull();
      expect(raw.rows[0]!.goal_enc).toBeNull();
      expect(raw.rows[0]!.profession_enc).toBeNull();

      const patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.phone).toBeNull();
      expect(patient!.goal).toBeNull();
      expect(patient!.profession).toBeNull();
    });

    it('profissão: round-trip cifrado (storage ilegível) + update reflete', async () => {
      const patientId = await createPatient(
        exec,
        userId,
        { name: 'Com Profissão', profession: 'Engenheira civil' },
        KEY,
      );
      const raw = await exec.query<{ profession_enc: string }>(
        'SELECT profession_enc FROM patient WHERE id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.profession_enc).not.toContain('Engenheira');

      let patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.profession).toBe('Engenheira civil');

      await updatePatient(exec, patientId, { name: 'Com Profissão', profession: 'Arquiteta' }, KEY);
      patient = await loadPatient(exec, patientId, KEY);
      expect(patient!.profession).toBe('Arquiteta');
    });

    it('paciente inexistente ⇒ null', async () => {
      expect(await loadPatient(exec, '00000000-0000-0000-0000-000000000000', KEY)).toBeNull();
    });
  });

  describe('Escopo por médico (FR23 — sem vazamento entre médicos)', () => {
    it('listPatients retorna só os pacientes do dono', async () => {
      const drA = await insertUser(exec, 'dra@nutrimed.test');
      const drB = await insertUser(exec, 'drb@nutrimed.test');
      await createPatient(exec, drA, { name: 'Paciente de A' }, KEY);
      await createPatient(exec, drB, { name: 'Paciente de B' }, KEY);

      const listA = await listPatients(exec, drA, KEY);
      const listB = await listPatients(exec, drB, KEY);
      expect(listA.map((p) => p.name)).toContain('Paciente de A');
      expect(listA.map((p) => p.name)).not.toContain('Paciente de B');
      expect(listB.map((p) => p.name)).toContain('Paciente de B');
    });

    it('ordena alfabeticamente pelo nome decifrado (acentos e caixa não atrapalham)', async () => {
      const dr = await insertUser(exec, 'alfabetica@nutrimed.test');
      // Criados fora de ordem — inclusive com acento, que deve ordenar junto
      // da letra base (Á entre A's, não depois do Z).
      await createPatient(exec, dr, { name: 'zuleica' }, KEY);
      await createPatient(exec, dr, { name: 'Bruno' }, KEY);
      await createPatient(exec, dr, { name: 'Álvaro' }, KEY);
      await createPatient(exec, dr, { name: 'ana' }, KEY);

      const list = await listPatients(exec, dr, KEY);
      expect(list.map((p) => p.name)).toEqual(['Álvaro', 'ana', 'Bruno', 'zuleica']);

      // Paginação acontece DEPOIS da ordenação alfabética.
      const page2 = await listPatients(exec, dr, KEY, { limit: 2, offset: 2 });
      expect(page2.map((p) => p.name)).toEqual(['Bruno', 'zuleica']);

      // orderBy: 'recent' não reordena alfabeticamente (comportamento antigo) —
      // sem asserção de posição exata: created_at pode empatar no mesmo ms.
      const recent = await listPatients(exec, dr, KEY, { orderBy: 'recent' });
      expect(recent.map((p) => p.name).sort()).toEqual(['Bruno', 'ana', 'zuleica', 'Álvaro'].sort());
    });

    it('pagina com limit/offset e conta o total (sem sobreposição entre páginas)', async () => {
      const dr = await insertUser(exec, 'paginacao@nutrimed.test');
      for (let i = 0; i < 5; i += 1) await createPatient(exec, dr, { name: `P${i}` }, KEY);

      expect(await countPatients(exec, dr)).toBe(5);
      const page1 = await listPatients(exec, dr, KEY, { limit: 2, offset: 0 });
      const page2 = await listPatients(exec, dr, KEY, { limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      const ids1 = new Set(page1.map((p) => p.id));
      expect(page2.some((p) => ids1.has(p.id))).toBe(false);
      // countPatients é escopado por médico
      expect(await countPatients(exec, '00000000-0000-0000-0000-000000000000')).toBe(0);
    });
  });

  describe('Medições — blob JSON cifrado, ordenado por data (FR25 / ADR-011)', () => {
    it('grava composição corporal cifrada, lista em ordem cronológica e audita', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Evolução BIA' }, KEY);
      await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-03-01'), values: { peso: 90, massaGordura: 30 } },
        KEY,
      );
      await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-01-01'), values: { peso: 95, massaGordura: 33 } },
        KEY,
      );

      const raw = await exec.query<{ values_enc: string }>(
        'SELECT values_enc FROM body_composition WHERE patient_id = $1 LIMIT 1',
        [patientId],
      );
      // NÃO afirmar ausência de substrings curtas ('90') — ciphertext base64
      // aleatório as contém com probabilidade real (flake visto no CI). O que
      // importa: o JSON em claro não está no storage.
      expect(raw.rows[0]!.values_enc).not.toContain('"peso"');
      expect(raw.rows[0]!.values_enc).not.toContain('peso');
      expect(raw.rows[0]!.values_enc).not.toContain(JSON.stringify({ peso: 90, massaGordura: 30 }));

      const evo = await listBodyComposition(exec, patientId, KEY);
      expect(evo.map((m) => m.values.peso)).toEqual([95, 90]); // cronológico: jan, mar
      expect(evo[0]!.values.massaGordura).toBe(33);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.filter((e) => e.triggeredBy === 'measurement-add').length).toBe(2);
    });

    it('aceita medição parcial de exame (só um marcador)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Evolução Lab' }, KEY);
      await addLabExam(exec, patientId, { measuredAt: new Date('2026-02-01'), values: { hba1c: 6.2 } }, KEY);

      const evo = await listLabExam(exec, patientId, KEY);
      expect(evo).toHaveLength(1);
      expect(evo[0]!.values.hba1c).toBe(6.2);
      expect(evo[0]!.values.ldl).toBeUndefined();
    });

    it('medições no MESMO dia saem na ordem de inserção (created_at), não por id', async () => {
      // Cenário do bug real: dois exames lançados no mesmo dia recebem
      // measured_at idêntico; o desempate por UUID aleatório embaralhava o
      // gráfico. Forçamos id e created_at em OPOSIÇÃO para o teste ser
      // determinístico: se o ORDER BY usar id, o resultado sai invertido.
      const patientId = await createPatient(exec, userId, { name: 'Mesmo Dia' }, KEY);
      const day = new Date('2026-05-01T00:00:00Z');
      const idA = await addLabExam(exec, patientId, { measuredAt: day, values: { ldl: 100 } }, KEY);
      const idB = await addLabExam(exec, patientId, { measuredAt: day, values: { ldl: 120 } }, KEY);

      // A (1º lançado, ldl=100): id MAIOR, created_at MENOR.
      // B (2º lançado, ldl=120): id menor, created_at maior.
      await exec.query(
        `UPDATE lab_exam SET id = 'ffffffff-ffff-4fff-8fff-ffffffffffff', created_at = '2026-05-01T09:00:00Z' WHERE id = $1`,
        [idA],
      );
      await exec.query(
        `UPDATE lab_exam SET id = '00000000-0000-4000-8000-000000000001', created_at = '2026-05-01T10:00:00Z' WHERE id = $1`,
        [idB],
      );

      const evo = await listLabExam(exec, patientId, KEY);
      expect(evo.map((m) => m.values.ldl)).toEqual([100, 120]); // ordem de lançamento
    });

    it('lab_exam faz roundtrip dos exames personalizados (custom1..custom3)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Custom Lab' }, KEY);
      await addLabExam(
        exec,
        patientId,
        { measuredAt: new Date('2026-06-01'), values: { custom1: 2.5, custom3: 31.2 } },
        KEY,
      );
      const evo = await listLabExam(exec, patientId, KEY);
      expect(evo[0]!.values.custom1).toBe(2.5);
      expect(evo[0]!.values.custom2).toBeUndefined();
      expect(evo[0]!.values.custom3).toBe(31.2);
    });

    it('vincula a consulta de origem quando informada', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Com Origem' }, KEY);
      const c = await exec.query<{ id: string }>(
        'INSERT INTO consultation (user_id, patient_label_enc, patient_id) VALUES ($1, $2, $3) RETURNING id',
        [userId, 'x', patientId],
      );
      const consultationId = c.rows[0]!.id;
      await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-04-01'), values: { peso: 80 }, sourceConsultationId: consultationId },
        KEY,
      );
      const evo = await listBodyComposition(exec, patientId, KEY);
      expect(evo[0]!.sourceConsultationId).toBe(consultationId);
    });
  });

  describe('Editar/excluir medições — soft-delete auditado (feedback do piloto)', () => {
    it('update recifra os valores e a listagem reflete a correção', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Correção' }, KEY);
      const id = await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-06-01'), values: { peso: 90 } },
        KEY,
      );
      await updateBodyComposition(
        exec,
        patientId,
        id,
        { measuredAt: new Date('2026-06-02'), values: { peso: 89, cintura: 100 } },
        KEY,
      );
      const evo = await listBodyComposition(exec, patientId, KEY);
      expect(evo).toHaveLength(1);
      expect(evo[0]!.values).toEqual({ peso: 89, cintura: 100 });
      expect(evo[0]!.measuredAt.toISOString().slice(0, 10)).toBe('2026-06-02');

      const trail = await getAuditTrail(exec, patientId);
      const edit = trail.find((e) => e.triggeredBy === 'measurement-edit');
      expect(edit).toBeDefined();
      expect(edit!.modelVersion).toBe('human-edit');
    });

    it('update/softDelete com paciente errado NÃO tocam a medição (posse no WHERE)', async () => {
      const owner = await createPatient(exec, userId, { name: 'Dono' }, KEY);
      const other = await createPatient(exec, userId, { name: 'Outro' }, KEY);
      const id = await addLabExam(
        exec,
        owner,
        { measuredAt: new Date('2026-06-01'), values: { ldl: 120 } },
        KEY,
      );
      await expect(
        updateLabExam(exec, other, id, { measuredAt: new Date(), values: { ldl: 1 } }, KEY),
      ).rejects.toThrow(/não encontrada/);
      await expect(softDeleteLabExam(exec, other, id)).rejects.toThrow(/não encontrada/);
      // intocada
      const evo = await listLabExam(exec, owner, KEY);
      expect(evo[0]!.values.ldl).toBe(120);
    });

    it('softDelete some das listagens, mantém a linha no banco e 2ª exclusão falha', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Excluir' }, KEY);
      const id = await addBodyComposition(
        exec,
        patientId,
        { measuredAt: new Date('2026-06-01'), values: { peso: 80 } },
        KEY,
      );
      await softDeleteBodyComposition(exec, patientId, id);

      expect(await listBodyComposition(exec, patientId, KEY)).toHaveLength(0);
      // soft: a linha PERMANECE (trilha/retensão CJ-2), só marcada
      const raw = await exec.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM body_composition WHERE id = $1',
        [id],
      );
      expect(raw.rows).toHaveLength(1);
      expect(raw.rows[0]!.deleted_at).not.toBeNull();

      await expect(softDeleteBodyComposition(exec, patientId, id)).rejects.toThrow(/não encontrada/);
      // excluída também não é editável
      await expect(
        updateBodyComposition(exec, patientId, id, { measuredAt: new Date(), values: { peso: 1 } }, KEY),
      ).rejects.toThrow(/não encontrada/);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'measurement-delete')).toBe(true);
    });
  });

  describe('Exames personalizados por paciente — cifrados e auditados', () => {
    it('grava cifrado (nome ilegível no storage), roundtrip e audita custom-exams-set', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Com Custom' }, KEY);
      await setCustomExamDefs(
        exec,
        patientId,
        [
          { slot: 1, name: 'TSH', unit: 'µUI/mL' },
          { slot: 3, name: 'Vitamina D' },
        ],
        KEY,
      );

      const raw = await exec.query<{ custom_exams_enc: string | null }>(
        'SELECT custom_exams_enc FROM patient WHERE id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.custom_exams_enc).not.toBeNull();
      expect(raw.rows[0]!.custom_exams_enc).not.toContain('TSH');
      expect(raw.rows[0]!.custom_exams_enc).not.toContain('Vitamina');

      const defs = await loadCustomExamDefs(exec, patientId, KEY);
      expect(defs).toEqual([
        { slot: 1, name: 'TSH', unit: 'µUI/mL' },
        { slot: 3, name: 'Vitamina D' },
      ]);

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.some((e) => e.triggeredBy === 'custom-exams-set')).toBe(true);
    });

    it('paciente sem definições ⇒ lista vazia; salvar [] limpa a coluna', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sem Custom' }, KEY);
      expect(await loadCustomExamDefs(exec, patientId, KEY)).toEqual([]);

      await setCustomExamDefs(exec, patientId, [{ slot: 2, name: 'Ferritina' }], KEY);
      expect(await loadCustomExamDefs(exec, patientId, KEY)).toHaveLength(1);

      await setCustomExamDefs(exec, patientId, [], KEY);
      const raw = await exec.query<{ custom_exams_enc: string | null }>(
        'SELECT custom_exams_enc FROM patient WHERE id = $1',
        [patientId],
      );
      expect(raw.rows[0]!.custom_exams_enc).toBeNull();
      expect(await loadCustomExamDefs(exec, patientId, KEY)).toEqual([]);
    });
  });

  describe('Metas corporais — versionadas por append, cifradas e auditadas', () => {
    it('vigente = maior effective_from <= asOf; cifrada; audita body-goal-set', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Com Meta' }, KEY);
      await setBodyGoal(exec, patientId, userId, '2026-01-01', { peso: 80, pgc: 22 }, KEY);
      await setBodyGoal(exec, patientId, userId, '2026-06-01', { peso: 75 }, KEY);

      const raw = await exec.query<{ values_enc: string }>(
        'SELECT values_enc FROM body_goal WHERE patient_id = $1 LIMIT 1',
        [patientId],
      );
      expect(raw.rows[0]!.values_enc).not.toContain('peso');

      // Entre as duas vigências ⇒ pega a antiga (com pgc).
      const antiga = await loadCurrentBodyGoal(exec, patientId, KEY, '2026-03-01');
      expect(antiga!.values).toEqual({ peso: 80, pgc: 22 });
      expect(antiga!.effectiveFrom).toBe('2026-01-01');

      // Sem asOf (hoje) ⇒ pega a mais recente (meta parcial é válida).
      const vigente = await loadCurrentBodyGoal(exec, patientId, KEY);
      expect(vigente!.values).toEqual({ peso: 75 });
      expect(vigente!.values.pgc).toBeUndefined();

      const trail = await getAuditTrail(exec, patientId);
      expect(trail.filter((e) => e.triggeredBy === 'body-goal-set').length).toBe(2);
    });

    it('paciente sem meta corporal ⇒ null (e vigência futura não vale hoje)', async () => {
      const patientId = await createPatient(exec, userId, { name: 'Sem Meta' }, KEY);
      expect(await loadCurrentBodyGoal(exec, patientId, KEY)).toBeNull();

      await setBodyGoal(exec, patientId, userId, '2099-01-01', { peso: 70 }, KEY);
      expect(await loadCurrentBodyGoal(exec, patientId, KEY)).toBeNull();
      expect(await loadCurrentBodyGoal(exec, patientId, KEY, '2099-06-01')).not.toBeNull();
    });
  });

  describe('computeAge — idade derivada (não persistida)', () => {
    it('calcula anos completos relativos a uma data de referência', () => {
      expect(computeAge('1990-02-15', new Date('2026-06-23'))).toBe(36);
      expect(computeAge('1990-12-31', new Date('2026-06-23'))).toBe(35); // ainda não fez aniversário
    });
    it('retorna null para data ausente ou inválida', () => {
      expect(computeAge(null, new Date('2026-06-23'))).toBeNull();
      expect(computeAge('não-é-data', new Date('2026-06-23'))).toBeNull();
    });
  });
});
