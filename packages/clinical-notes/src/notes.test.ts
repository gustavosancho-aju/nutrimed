import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';
import { getAuditTrail } from '@nutrimed/audit';
import type { LlmCompletionRequest, PersonaContribution } from '@nutrimed/providers';
import { generateNoteDraft, saveNote, loadNote, saveSynthesis, listSyntheses } from './notes';

function fromPglite(db: PGlite): SqlExecutor {
  return {
    exec: async (sql: string): Promise<void> => {
      await db.exec(sql);
    },
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const result = await db.query<T>(text, params as unknown[]);
      return { rows: result.rows };
    },
  };
}

const KEY = randomBytes(32);

describe('Documentation Service (E9 — FR17)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let consultationId: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = fromPglite(db);
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

  describe('9.1 — geração da nota a partir da transcrição estruturada (AC1)', () => {
    it('envia transcrição numerada + contribuições do board ao LLM com prompt fiel', async () => {
      let captured: LlmCompletionRequest | null = null;
      const llm = {
        complete: async (req: LlmCompletionRequest): Promise<PersonaContribution> => {
          captured = req;
          return { personaId: 'aurelio', type: 'sintese', severity: 'normal', text: '## Resumo da consulta\nNota.' };
        },
      };
      const draft = await generateNoteDraft(
        llm,
        ['Paciente relata cansaço.', 'Iniciaremos semaglutida.'],
        [{ personaId: 'paulo', type: 'atencao', severity: 'critical', text: 'Checar PA antes.' }],
      );
      expect(draft).toContain('Resumo da consulta');
      expect(captured!.system).toContain('NÃO invente');
      expect(captured!.system).toContain('revisado e validado pelo médico');
      expect(captured!.transcript).toContain('1. Paciente relata cansaço.');
      expect(captured!.transcript).toContain('[paulo/atencao] Checar PA antes.');
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
});
