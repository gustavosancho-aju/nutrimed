/**
 * Backup lógico offsite do banco de produção (belt-and-suspenders além do PITR
 * gerenciado do Neon). Usa `pg_dump` no formato custom (-Fc), restaurável com
 * `pg_restore`. O dump contém os campos clínicos JÁ CIFRADOS (values_enc etc.) —
 * mas isso NÃO substitui guardar a DATA_ENCRYPTION_KEY em separado: sem a chave,
 * o dump é indecifrável (e é exatamente essa a proteção). NUNCA comite o dump.
 *
 * Pré-requisito: `pg_dump` no PATH (PostgreSQL client tools).
 * Uso:
 *   DATABASE_URL="postgres://..." node scripts/db-backup.mjs [pasta-destino]
 * Saída: <pasta>/nutrimed-YYYYMMDD-HHmmss.dump  (default: ./backups, gitignored)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL ausente.');
  process.exit(1);
}

const probe = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
if (probe.error) {
  console.error(
    'pg_dump não encontrado no PATH. Instale o PostgreSQL client (inclui pg_dump) e tente de novo.',
  );
  process.exit(1);
}

const outDir = resolve(process.argv[2] ?? 'backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replace(/[:T]/g, '')
  .replace(/\..+/, '')
  .slice(0, 15); // YYYYMMDD-HHmmss-ish
const outFile = resolve(outDir, `nutrimed-${stamp}.dump`);

console.log(`Gerando dump com ${probe.stdout.trim()} → ${outFile}`);
const dump = spawnSync('pg_dump', [url, '-Fc', '--no-owner', '--no-privileges', '-f', outFile], {
  stdio: 'inherit',
});
if (dump.status !== 0) {
  console.error('pg_dump falhou.');
  process.exit(dump.status ?? 1);
}
console.log(`✅ Backup pronto: ${outFile}`);
console.log(
  '⚠️  Guarde este arquivo FORA do servidor e a DATA_ENCRYPTION_KEY em local SEPARADO — ' +
    'sem a chave o dump é indecifrável (e sem o dump a chave é inútil).',
);
