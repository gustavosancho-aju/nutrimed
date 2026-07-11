import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor, type SqlExecutor } from '@nutrimed/db';
import { assertConsultationOwner, consultationBelongsTo } from './consultation-owner';

/**
 * Defesa contra BOLA: a posse da consulta é verificada por user_id — um médico
 * autenticado NÃO pode agir sobre a consulta de outro conhecendo o UUID.
 */
describe('consultation-owner (autorização por posse)', () => {
  let db: PGlite;
  let exec: SqlExecutor;
  let drA: string;
  let drB: string;
  let consultaDeA: string;

  beforeAll(async () => {
    db = new PGlite();
    exec = pgliteExecutor(db);
    await runMigrations(exec);
    const a = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      ['a@nutrimed.test', 'Dr. A', 'x'],
    );
    const b = await exec.query<{ id: string }>(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id',
      ['b@nutrimed.test', 'Dr. B', 'x'],
    );
    drA = a.rows[0]!.id;
    drB = b.rows[0]!.id;
    const c = await exec.query<{ id: string }>(
      'INSERT INTO consultation (user_id, patient_label_enc) VALUES ($1,$2) RETURNING id',
      [drA, 'enc'],
    );
    consultaDeA = c.rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('consultationBelongsTo: true só para o dono', async () => {
    expect(await consultationBelongsTo(exec, consultaDeA, drA)).toBe(true);
    expect(await consultationBelongsTo(exec, consultaDeA, drB)).toBe(false);
  });

  it('consultationBelongsTo: false para consultationId vazio ou inexistente', async () => {
    expect(await consultationBelongsTo(exec, '', drA)).toBe(false);
    expect(
      await consultationBelongsTo(exec, '00000000-0000-0000-0000-000000000000', drA),
    ).toBe(false);
  });

  it('assertConsultationOwner: passa para o dono, lança ConsultationNotFoundError para outro', async () => {
    await expect(assertConsultationOwner(exec, consultaDeA, drA)).resolves.toBeUndefined();
    await expect(assertConsultationOwner(exec, consultaDeA, drB)).rejects.toMatchObject({
      name: 'ConsultationNotFoundError',
    });
  });
});
