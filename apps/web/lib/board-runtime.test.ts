import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, type SqlExecutor } from '@nutrimed/db';
import { createConsultation } from '@nutrimed/consent';

/**
 * A1 — rollback do startLiveBoard: consulta SEM consentimento (default NEGA,
 * FR20) deve falhar com ConsentRequiredError e NÃO deixar audio sink órfão no
 * gateway (o incidente de produção: sink registrado antes do gate).
 */

const { holder } = vi.hoisted(() => ({
  holder: { db: null as SqlExecutor | null },
}));

vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({ getDb: async () => holder.db! }));
vi.mock('./crypto-key', () => ({ getEncryptionKey: () => Buffer.alloc(32, 7) }));

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

describe('startLiveBoard (A1 — gate de consentimento antes do sink)', () => {
  let runtimeModule: typeof import('./board-runtime');
  let consultationId: string;

  beforeAll(async () => {
    process.env.BOARD_WS_PORT = '0'; // porta efêmera — não conflita com dev/testes paralelos
    process.env.DEEPGRAM_API_KEY = 'dg-test-key';
    const pglite = new PGlite();
    const db = fromPglite(pglite);
    await runMigrations(db);
    holder.db = db;

    const user = await db.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash) VALUES ('m@t.dev', 'Med', 'x') RETURNING id",
    );
    // consentimento criado com granted=false (default NEGA)
    consultationId = await createConsultation(db, user.rows[0]!.id, 'Paciente T.', Buffer.alloc(32, 7));

    runtimeModule = await import('./board-runtime');
  });

  afterAll(async () => {
    const runtime = await runtimeModule.getBoardRuntime();
    await runtime.gateway.close();
  });

  it('sem consentimento: lança ConsentRequiredError e nenhum sink fica registrado', async () => {
    await expect(runtimeModule.startLiveBoard(consultationId)).rejects.toMatchObject({
      name: 'ConsentRequiredError',
    });

    const runtime = await runtimeModule.getBoardRuntime();
    expect(runtime.gateway.hasAudioSink(consultationId)).toBe(false);
    expect(runtime.active.has(consultationId)).toBe(false);
  });

  it('A4 — getNoteInputs cai no BANCO quando a sessão não está ativa (pós-restart/deploy)', async () => {
    const key = Buffer.alloc(32, 7); // mesma chave do mock de getEncryptionKey
    const { saveTranscriptSegment, saveSynthesis } = await import('@nutrimed/clinical-notes');
    await saveTranscriptSegment(holder.db!, consultationId, 0, 'Paciente relata palpitação.', key);
    await saveTranscriptSegment(holder.db!, consultationId, 1, 'Vamos revisar a medicação.', key);
    await saveSynthesis(holder.db!, consultationId, 'Síntese que sobreviveu ao restart.', key, 'claude-haiku-4-5');

    const inputs = await runtimeModule.getNoteInputs(consultationId);
    expect(inputs).not.toBeNull();
    expect(inputs!.finals).toEqual(['Paciente relata palpitação.', 'Vamos revisar a medicação.']);
    expect(inputs!.contributions).toHaveLength(1);
    expect(inputs!.contributions[0]).toMatchObject({
      personaId: 'aurelio',
      type: 'sintese',
      text: 'Síntese que sobreviveu ao restart.',
    });
  });

  it('A4 — consulta sem transcript nem sínteses → null (mensagem no-transcript)', async () => {
    const user = await holder.db!.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash) VALUES ('m2@t.dev', 'Med2', 'x') RETURNING id",
    );
    const emptyConsultation = await createConsultation(holder.db!, user.rows[0]!.id, 'Vazio', Buffer.alloc(32, 7));
    expect(await runtimeModule.getNoteInputs(emptyConsultation)).toBeNull();
  });
});
