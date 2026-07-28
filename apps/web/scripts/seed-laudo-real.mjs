/**
 * Semeia o banco LOCAL (PGlite em apps/web/.pgdata) com o painel laboratorial de
 * um laudo REAL, passando pelo MESMO caminho de código da server action de
 * importação (extractPanel → toStoredAnalyte → resolveSlugCollisions →
 * addLabExam → planHistoryImport).
 *
 *   cd apps/web && npx tsx --env-file=.env.local scripts/seed-laudo-real.mjs <laudo.pdf> ["Nome do paciente"]
 *   cd apps/web && npx tsx --env-file=.env.local scripts/seed-laudo-real.mjs --remove ["Nome"]
 *
 * Existe porque o input de arquivo não é alcançável pelo painel de navegação
 * (política de origem), e verificar as telas de exames com 6 analitos do
 * extrator fake não prova nada sobre um painel real de 70 — que é onde
 * agrupamento, colisão de slug e volume aparecem.
 *
 * A extração é CACHEADA em .laudo-cache.json ao lado do PDF de entrada: rodar de
 * novo não paga outra chamada de API. Apague o cache para reextrair.
 *
 * O paciente precisa EXISTIR — mesma regra do seed-plano-12-meses: semear no
 * paciente errado é pior que falhar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor } from '@nutrimed/db';
import { loadEncryptionKey } from '@nutrimed/crypto';
import { decryptField } from '@nutrimed/crypto';
import { addLabExam, listLabExam } from '@nutrimed/patients';
import { parseReferenceRange } from '@nutrimed/lab-catalog';
import { ClaudeLabExtractor } from '../../../packages/lab-import/src/claude-extractor.ts';
import {
  toStoredAnalyte,
  resolveSlugCollisions,
  planHistoryImport,
  existingHistoryKeys,
} from '../lib/lab-panel.ts';

const REMOVE_MODE = process.argv[2] === '--remove';
const PDF_PATH = REMOVE_MODE ? null : process.argv[2];
const PATIENT_NAME = (REMOVE_MODE ? process.argv[3] : process.argv[3]) ?? 'Gustavo (Teste Importação)';

/** Ações de auditoria criadas por este seed — usadas para limpar (--remove). */
const ACOES = ['lab-panel-import', 'lab-panel-import-historico'];

async function extrairComCache(pdfPath) {
  const cachePath = path.join(path.dirname(pdfPath), '.laudo-cache.json');
  if (fs.existsSync(cachePath)) {
    console.log(`Cache de extração: ${cachePath}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente — rode com --env-file=.env.local');
  const extractor = new ClaudeLabExtractor({ apiKey });
  console.log('Extraindo o laudo (chamada de API)…');
  const panel = await extractor.extractPanel({
    base64: fs.readFileSync(pdfPath).toString('base64'),
    filename: path.basename(pdfPath),
  });
  fs.writeFileSync(cachePath, JSON.stringify(panel, null, 2));
  console.log(`Extração cacheada em ${cachePath}`);
  return panel;
}

async function main() {
  const key = loadEncryptionKey();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pgdata = path.join(here, '..', '.pgdata');
  console.log(`Banco local: ${pgdata}`);
  const db = new PGlite(pgdata);
  const exec = pgliteExecutor(db);
  await runMigrations(exec);

  const user = await exec.query('SELECT id FROM app_user ORDER BY created_at LIMIT 1');
  if (user.rows.length === 0) throw new Error('Banco sem usuário — rode o seed do plano primeiro.');
  const userId = user.rows[0].id;

  // Paciente pelo nome EXATO (o nome é cifrado, então decifra para comparar).
  const pacientes = await exec.query('SELECT id, name_enc FROM patient WHERE user_id = $1', [userId]);
  let patientId = null;
  const nomes = [];
  for (const row of pacientes.rows) {
    const nome = decryptField(row.name_enc, key);
    nomes.push(nome);
    if (nome === PATIENT_NAME) patientId = row.id;
  }
  if (!patientId) {
    console.error(`Paciente "${PATIENT_NAME}" não encontrado. Existentes:`);
    for (const n of nomes) console.error(`  - ${n}`);
    process.exit(1);
  }
  console.log(`Paciente: ${PATIENT_NAME} (${patientId})`);

  // Limpeza: remove o que ESTE seed criou (hard delete — é banco local de teste).
  const antes = await listLabExam(exec, patientId, key);
  const semeadas = antes.filter((m) => (m.values.panel?.length ?? 0) > 0);
  if (semeadas.length > 0) {
    for (const m of semeadas) await exec.query('DELETE FROM lab_exam WHERE id = $1', [m.id]);
    console.log(`Removidas ${semeadas.length} medições com painel de execuções anteriores.`);
  }
  if (REMOVE_MODE) {
    console.log('Modo --remove: nada semeado.');
    await db.close();
    return;
  }

  const panel = await extrairComCache(path.resolve(PDF_PATH));
  const dataColeta = panel.measuredAt ?? new Date().toISOString().slice(0, 10);

  // MESMO caminho da server action: canonicaliza, resolve colisões, grava.
  const confirmados = panel.analytes.map((a) => ({
    stored: toStoredAnalyte({
      rawName: a.rawName,
      value: a.value,
      unit: a.unit,
      range: parseReferenceRange(a.referenceText),
      refText: a.referenceText,
    }),
    history: a.history,
  }));
  const analitos = resolveSlugCollisions(confirmados.map((c) => c.stored));

  await addLabExam(
    exec,
    patientId,
    { measuredAt: new Date(`${dataColeta}T00:00:00Z`), values: { panel: analitos } },
    key,
    { action: ACOES[0], modelVersion: 'claude-haiku-4-5' },
  );
  console.log(`Coleta ${dataColeta}: ${analitos.length} analitos gravados.`);

  const planejadas = planHistoryImport({
    analytes: analitos.map((stored, i) => ({
      slug: stored.slug,
      label: stored.label,
      ...(stored.unit ? { unit: stored.unit } : {}),
      ...(confirmados[i].history ? { history: confirmados[i].history } : {}),
    })),
    existing: existingHistoryKeys(await listLabExam(exec, patientId, key)),
    collectionDate: dataColeta,
  });
  for (const p of planejadas) {
    await addLabExam(
      exec,
      patientId,
      { measuredAt: new Date(`${p.measuredAt}T00:00:00Z`), values: { panel: p.analytes } },
      key,
      { action: ACOES[1], modelVersion: 'laudo-evolucao' },
    );
  }
  console.log(
    `Histórico do laudo: ${planejadas.length} datas anteriores ` +
      `(${planejadas.map((p) => `${p.measuredAt}:${p.analytes.length}`).join(', ')})`,
  );

  const total = await listLabExam(exec, patientId, key);
  console.log(`Total de medições laboratoriais do paciente: ${total.length}`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
