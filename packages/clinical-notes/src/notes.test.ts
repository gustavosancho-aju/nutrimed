import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor , pgliteExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';
import { getAuditTrail } from '@nutrimed/audit';
import { FakeTextCompleter, type PersonaContribution } from '@nutrimed/providers';
import {
  generateNoteDraft,
  saveNote,
  loadNote,
  saveSynthesis,
  listSyntheses,
  saveTranscriptSegment,
  listTranscriptFinals,
  auditTranscriptPersistStart,
  saveTranscriptReview,
  loadTranscriptReview,
  saveConsultationRecord,
  loadConsultationRecord,
  saveBoardFinalReview,
  listBoardFinalReview,
} from './notes';


const KEY = randomBytes(32);

describe('Documentation Service (E9 — FR17)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let userId: string;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const res = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['nutro@nutrimed.test', 'Dra. Demo', 'x'],
    );
    userId = res.rows[0]!.id;
    consultationId = await createConsultation(exec, userId, 'P', KEY);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('9.1 — geração da nota a partir da transcrição estruturada (AC1)', () => {
    const neverComplete = async (): Promise<PersonaContribution> => {
      throw new Error('a nota não deve usar o contrato JSON de contribuição');
    };

    it('envia transcrição numerada + contribuições do board via completeText (texto livre)', async () => {
      const texts = new FakeTextCompleter(['## Resumo da consulta\nNota.']);
      const draft = await generateNoteDraft(
        { complete: neverComplete, completeText: (req) => texts.completeText(req) },
        ['Paciente relata cansaço.', 'Iniciaremos semaglutida.'],
        [{ personaId: 'paulo', type: 'atencao', severity: 'critical', text: 'Checar PA antes.' }],
      );
      expect(draft.text).toContain('Resumo da consulta');
      expect(draft.modelVersion).toBe('fake-text-v1');
      const req = texts.requests[0]!;
      expect(req.system).toContain('NÃO invente');
      expect(req.system).toContain('revisado e validado pelo médico');
      expect(req.prompt).toContain('1. Paciente relata cansaço.');
      expect(req.prompt).toContain('[paulo/atencao] Checar PA antes.');
      // folga anti-truncamento: o incidente de 2026-07-15 nasceu de maxTokens curto
      expect(req.maxTokens).toBeGreaterThanOrEqual(4000);
    });

    it('resposta vazia jamais vira sucesso silencioso (dado clínico)', async () => {
      const texts = new FakeTextCompleter(['   ']);
      await expect(
        generateNoteDraft({ complete: neverComplete, completeText: (req) => texts.completeText(req) }, ['Fala.']),
      ).rejects.toThrow(/não gerou conteúdo/);
    });

    it('provider sem completeText falha com erro claro (sem fallback ao contrato JSON)', async () => {
      await expect(generateNoteDraft({ complete: neverComplete }, ['Fala.'])).rejects.toThrow(
        /completeText/,
      );
    });
  });

  describe('9.2 — persistência cifrada + auditada (AC2/AC3 — NFR9/NFR10)', () => {
    it('salva cifrado (ilegível no storage), carrega decifrado, e audita a geração', async () => {
      const content = '## Resumo\nPaciente Maria com platô ponderal e palpitação.';
      await saveNote(exec, consultationId, content, KEY, {
        action: 'generate',
        modelVersion: 'claude-haiku-4-5',
      });

      // storage bruto NÃO contém o texto em claro (NFR9)
      const raw = await exec.query<{ content_enc: string }>(
        'SELECT content_enc FROM clinical_note WHERE consultation_id = $1',
        [consultationId],
      );
      expect(raw.rows[0]!.content_enc).not.toContain('Maria');
      expect(raw.rows[0]!.content_enc).not.toContain('platô');

      const note = await loadNote(exec, consultationId, KEY);
      expect(note!.content).toBe(content);

      const trail = await getAuditTrail(exec, consultationId);
      expect(trail.some((e) => e.triggeredBy === 'clinical-note-generate')).toBe(true);
      expect(trail.find((e) => e.triggeredBy === 'clinical-note-generate')!.modelVersion).toBe('claude-haiku-4-5');
    });

    it('edição do médico ATUALIZA (1:1 por consulta) e audita como human-edit', async () => {
      await saveNote(exec, consultationId, 'Versão editada pelo médico.', KEY, { action: 'edit' });

      const count = await exec.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM clinical_note WHERE consultation_id = $1',
        [consultationId],
      );
      expect(Number(count.rows[0]!.count)).toBe(1); // update, não duplicação

      const note = await loadNote(exec, consultationId, KEY);
      expect(note!.content).toBe('Versão editada pelo médico.');

      const trail = await getAuditTrail(exec, consultationId);
      expect(trail.some((e) => e.triggeredBy === 'clinical-note-edit' && e.modelVersion === 'human-edit')).toBe(true);
    });

    it('nota inexistente → null (sem vazamento entre consultas)', async () => {
      expect(await loadNote(exec, '00000000-0000-0000-0000-000000000000', KEY)).toBeNull();
    });
  });

  describe('Sínteses do board persistidas (histórico da consulta)', () => {
    it('salva cifrada (ilegível no storage), lista em ordem cronológica e audita com o modelo', async () => {
      await saveSynthesis(exec, consultationId, 'Síntese 1: priorizar avaliação de tireoide.', KEY, 'claude-haiku-4-5');
      await saveSynthesis(exec, consultationId, 'Síntese 2: reavaliar dose após exames.', KEY, 'claude-haiku-4-5');

      const raw = await exec.query<{ content_enc: string }>(
        'SELECT content_enc FROM board_synthesis WHERE consultation_id = $1 LIMIT 1',
        [consultationId],
      );
      expect(raw.rows[0]!.content_enc).not.toContain('tireoide');

      const list = await listSyntheses(exec, consultationId, KEY);
      expect(list.map((s) => s.content)).toEqual([
        'Síntese 1: priorizar avaliação de tireoide.',
        'Síntese 2: reavaliar dose após exames.',
      ]);
      expect(list[0]!.modelVersion).toBe('claude-haiku-4-5');

      const trail = await getAuditTrail(exec, consultationId);
      expect(trail.filter((e) => e.triggeredBy === 'board-synthesis').length).toBe(2);
    });

    it('consulta sem sínteses → lista vazia (sem vazamento entre consultas)', async () => {
      expect(await listSyntheses(exec, '00000000-0000-0000-0000-000000000000', KEY)).toEqual([]);
    });
  });

  describe('Transcript persistido incrementalmente (A4)', () => {
    it('salva cada final cifrado (ilegível em claro) e lista em ordem de seq', async () => {
      await saveTranscriptSegment(exec, consultationId, 1, 'Iniciaremos semaglutida semanal.', KEY);
      await saveTranscriptSegment(exec, consultationId, 0, 'Paciente relata palpitação.', KEY);

      const raw = await exec.query<{ content_enc: string }>(
        'SELECT content_enc FROM transcript_segment WHERE consultation_id = $1 LIMIT 1',
        [consultationId],
      );
      expect(raw.rows[0]!.content_enc).not.toContain('palpitação');
      expect(raw.rows[0]!.content_enc).not.toContain('semaglutida');

      // ordem por seq (não por ordem de INSERT) — a nota reconstrói a fala fielmente
      expect(await listTranscriptFinals(exec, consultationId, KEY)).toEqual([
        'Paciente relata palpitação.',
        'Iniciaremos semaglutida semanal.',
      ]);
    });

    it('mesmo (consulta, seq) duplicado é ignorado — retry idempotente', async () => {
      await saveTranscriptSegment(exec, consultationId, 0, 'TEXTO DUPLICADO', KEY);
      const finals = await listTranscriptFinals(exec, consultationId, KEY);
      expect(finals[0]).toBe('Paciente relata palpitação.'); // o original venceu
      expect(finals).toHaveLength(2);
    });

    it('auditTranscriptPersistStart grava UMA trilha por sessão (não por segmento)', async () => {
      await auditTranscriptPersistStart(exec, consultationId);
      const trail = await getAuditTrail(exec, consultationId);
      expect(trail.filter((e) => e.triggeredBy === 'transcript-persist-start')).toHaveLength(1);
    });

    it('consulta sem transcript → lista vazia (sem vazamento entre consultas)', async () => {
      expect(await listTranscriptFinals(exec, '00000000-0000-0000-0000-000000000000', KEY)).toEqual([]);
    });
  });

  describe('Transcrição Confiável — revisão do médico (NFR9/NFR10)', () => {
    it('salva cifrado, carrega decifrado e audita como human-edit', async () => {
      expect(await loadTranscriptReview(exec, consultationId, KEY)).toBeNull();

      await saveTranscriptReview(exec, consultationId, 'Paciente relata dor precordial ao esforço.', KEY);

      // storage bruto ilegível (NFR9)
      const raw = await exec.query<{ content_enc: string }>(
        'SELECT content_enc FROM transcript_review WHERE consultation_id = $1',
        [consultationId],
      );
      expect(raw.rows[0]!.content_enc).not.toContain('precordial');

      const review = await loadTranscriptReview(exec, consultationId, KEY);
      expect(review!.content).toBe('Paciente relata dor precordial ao esforço.');

      const trail = await getAuditTrail(exec, consultationId);
      const entry = trail.find((e) => e.triggeredBy === 'transcript-reviewed');
      expect(entry).toBeDefined();
      expect(entry!.modelVersion).toBe('human-edit');
    });

    it('regravar sobrescreve a correção (1:1 com a consulta), sem tocar o transcript cru', async () => {
      await saveTranscriptSegment(exec, consultationId, 99, 'dor primordial', KEY); // cru intocado
      await saveTranscriptReview(exec, consultationId, 'dor precordial (corrigido)', KEY);
      await saveTranscriptReview(exec, consultationId, 'dor precordial ao subir escadas', KEY);

      const review = await loadTranscriptReview(exec, consultationId, KEY);
      expect(review!.content).toBe('dor precordial ao subir escadas');
      const count = await exec.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM transcript_review WHERE consultation_id = $1',
        [consultationId],
      );
      expect(count.rows[0]!.n).toBe(1);
      // o transcript cru do STT permanece como proveniência (o segmento seq 99 salvo acima)
      expect(await listTranscriptFinals(exec, consultationId, KEY)).toContain('dor primordial');
    });
  });

  describe('Ciclo 2 — prontuário manual (Conduta + Anotações do médico)', () => {
    it('nunca preenchido ⇒ null', async () => {
      expect(await loadConsultationRecord(exec, consultationId, KEY)).toBeNull();
    });

    it('salva só a conduta (annotations NULL), cifrada e auditada', async () => {
      await saveConsultationRecord(
        exec,
        consultationId,
        { conduct: 'Iniciar dieta hipocalórica com reavaliação em 30 dias.', annotations: null },
        KEY,
      );
      const raw = await exec.query<{ conduct_enc: string | null; annotations_enc: string | null }>(
        'SELECT conduct_enc, annotations_enc FROM consultation_record WHERE consultation_id = $1',
        [consultationId],
      );
      expect(raw.rows[0]!.conduct_enc).not.toContain('hipocalórica'); // NFR9
      expect(raw.rows[0]!.annotations_enc).toBeNull(); // sem placeholder cifrado

      const record = await loadConsultationRecord(exec, consultationId, KEY);
      expect(record!.conduct).toBe('Iniciar dieta hipocalórica com reavaliação em 30 dias.');
      expect(record!.annotations).toBeNull();

      const trail = await getAuditTrail(exec, consultationId);
      const edit = trail.find((e) => e.triggeredBy === 'consultation-record-edit');
      expect(edit).toBeDefined();
      expect(edit!.modelVersion).toBe('human-edit');
    });

    it('upsert: 2º save substitui os dois campos (1 linha por consulta)', async () => {
      await saveConsultationRecord(
        exec,
        consultationId,
        { conduct: 'Conduta revisada.', annotations: 'Paciente relatou melhora do sono.' },
        KEY,
      );
      const record = await loadConsultationRecord(exec, consultationId, KEY);
      expect(record!.conduct).toBe('Conduta revisada.');
      expect(record!.annotations).toBe('Paciente relatou melhora do sono.');

      const count = await exec.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM consultation_record WHERE consultation_id = $1',
        [consultationId],
      );
      expect(count.rows[0]!.n).toBe(1);
    });

    it('limpar um campo (vazio/whitespace) ⇒ NULL — edição legítima', async () => {
      await saveConsultationRecord(
        exec,
        consultationId,
        { conduct: '   ', annotations: 'Só a anotação fica.' },
        KEY,
      );
      const record = await loadConsultationRecord(exec, consultationId, KEY);
      expect(record!.conduct).toBeNull();
      expect(record!.annotations).toBe('Só a anotação fica.');
    });
  });

  describe('Parecer final do board (briefing do piloto 2026-07-19)', () => {
    it('nunca gerado ⇒ lista vazia', async () => {
      const other = await createConsultation(exec, userId, 'P2', KEY);
      expect(await listBoardFinalReview(exec, other, KEY)).toEqual([]);
    });

    it('salva cifrado (ilegível no storage), carrega decifrado e audita', async () => {
      await saveBoardFinalReview(
        exec,
        consultationId,
        'paulo',
        {
          faltouPerguntar: ['dor torácica aos esforços'],
          examesSolicitar: ['ECG de repouso'],
          condutas: [],
        },
        KEY,
        'claude-haiku-4-5',
      );
      const raw = await exec.query<{ content_enc: string }>(
        'SELECT content_enc FROM board_final_review WHERE consultation_id = $1 AND persona_id = $2',
        [consultationId, 'paulo'],
      );
      expect(raw.rows[0]!.content_enc).not.toContain('torácica');

      const list = await listBoardFinalReview(exec, consultationId, KEY);
      const paulo = list.find((r) => r.personaId === 'paulo');
      expect(paulo).toBeDefined();
      expect(paulo!.examesSolicitar).toEqual(['ECG de repouso']);
      expect(paulo!.modelVersion).toBe('claude-haiku-4-5');

      const trail = await getAuditTrail(exec, consultationId);
      expect(trail.some((e) => e.triggeredBy === 'board-final-review')).toBe(true);
    });

    it('upsert por persona: 2º save da mesma persona substitui (reabrir/re-encerrar)', async () => {
      await saveBoardFinalReview(
        exec,
        consultationId,
        'paulo',
        { faltouPerguntar: [], examesSolicitar: ['novo exame'], condutas: [] },
        KEY,
      );
      const list = await listBoardFinalReview(exec, consultationId, KEY);
      const paulos = list.filter((r) => r.personaId === 'paulo');
      expect(paulos).toHaveLength(1);
      expect(paulos[0]!.examesSolicitar).toEqual(['novo exame']);
    });

    it('personas distintas coexistem (1 linha cada, por consulta)', async () => {
      await saveBoardFinalReview(
        exec,
        consultationId,
        'yara',
        { faltouPerguntar: ['sintomas de hipotireoidismo'], examesSolicitar: [], condutas: [] },
        KEY,
      );
      const list = await listBoardFinalReview(exec, consultationId, KEY);
      expect(list.map((r) => r.personaId).sort()).toEqual(['paulo', 'yara']);
    });
  });
});
