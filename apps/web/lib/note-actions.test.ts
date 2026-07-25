import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor, pgliteExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';
import { loadNote } from '@nutrimed/clinical-notes';

/**
 * SALVAR ENCERRA A SESSÃO DO BOARD (2026-07-24) — par "de cenoura" das travas de
 * tempo do vazamento de custo: se o médico está salvando a nota, a consulta
 * acabou, então não há por que manter as personas e o case review rodando.
 * Invariante clínica que NÃO pode ser quebrada: falha ao encerrar nunca impede
 * salvar — registro de atendimento vem primeiro.
 */

const KEY = Buffer.alloc(32, 7);

const { holder } = vi.hoisted(() => ({
  holder: {
    db: null as SqlExecutor | null,
    userId: '',
    stopCalls: [] as string[],
    stopShouldThrow: false,
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('./db', () => ({ getDb: async () => holder.db! }));
vi.mock('./crypto-key', () => ({ getEncryptionKey: () => Buffer.alloc(32, 7) }));
vi.mock('./auth', () => ({ getCurrentUser: async () => ({ id: holder.userId }) }));
vi.mock('./board-runtime', () => ({
  getNoteInputs: async () => ({ transcriptFinals: [], contributions: [] }),
  stopLiveBoard: async (id: string) => {
    holder.stopCalls.push(id);
    if (holder.stopShouldThrow) throw new Error('gateway caiu');
  },
}));

describe('saveNoteAction — salvar encerra a sessão do board', () => {
  let actions: typeof import('./note-actions');
  let consultationId: string;

  beforeAll(async () => {
    const db = pgliteExecutor(new PGlite());
    await runMigrations(db);
    holder.db = db;
    const user = await db.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash) VALUES ('m@t.dev', 'Med', 'x') RETURNING id",
    );
    holder.userId = user.rows[0]!.id;
    consultationId = await createConsultation(db, holder.userId, 'Paciente T.', KEY);
    actions = await import('./note-actions');
  });

  beforeEach(() => {
    holder.stopCalls = [];
    holder.stopShouldThrow = false;
  });

  function form(content: string): FormData {
    const data = new FormData();
    data.set('consultationId', consultationId);
    data.set('content', content);
    return data;
  }

  it('salva a nota E encerra a sessão do board da consulta', async () => {
    await actions.saveNoteAction(form('Conduta: manter dieta.'));

    expect(holder.stopCalls).toEqual([consultationId]);
    const note = await loadNote(holder.db!, consultationId, KEY);
    expect(note?.content).toBe('Conduta: manter dieta.');
  });

  it('falha ao encerrar NÃO impede salvar (registro clínico vem primeiro)', async () => {
    holder.stopShouldThrow = true;

    await expect(actions.saveNoteAction(form('Nota que precisa sobreviver.'))).resolves.toBeUndefined();
    const note = await loadNote(holder.db!, consultationId, KEY);
    expect(note?.content).toBe('Nota que precisa sobreviver.');
  });

  it('nota vazia continua rejeitada e não encerra nada', async () => {
    await expect(actions.saveNoteAction(form('   '))).rejects.toThrow(/vazia/i);
    expect(holder.stopCalls).toEqual([]);
  });
});
