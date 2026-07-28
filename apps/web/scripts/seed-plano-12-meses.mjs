/**
 * Semeia o banco LOCAL (PGlite em apps/web/.pgdata) com um paciente de teste e
 * 12 meses de registro alimentar — insumo para verificar no navegador o
 * histórico mês a mês (E15 fases 3 e 4).
 *
 * NUNCA toca em produção: o app local usa PGlite em arquivo; o Neon só é usado
 * quando DATABASE_URL está definido (não está no .env.local).
 *
 * Vive em apps/web/scripts (e não em scripts/ na raiz) porque o Node resolve
 * imports pela localização DO ARQUIVO: no pnpm, só aqui `@electric-sql/pglite`
 * e os pacotes do workspace estão visíveis.
 *
 * Uso:
 *   cd apps/web && npx tsx --env-file=.env.local scripts/seed-plano-12-meses.mjs
 *
 * Idempotente: reexecutar limpa os registros semeados do paciente e refaz.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations, pgliteExecutor } from '@nutrimed/db';
import { loadEncryptionKey } from '@nutrimed/crypto';
import { createPatient, setNutritionGoal, addFoodLogEntry } from '@nutrimed/patients';
import { hashPassword } from '@nutrimed/auth';

const PATIENT_NAME = 'Gustavo';
const TZ = -180; // BR
const DEMO_EMAIL = 'demo@nutrimed.test';
const DEMO_PASSWORD = 'nutrimed123';

/** PRNG determinístico (mulberry32) — o seed é reproduzível entre execuções. */
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260728);

/** Meio-dia local do dia (12:00 em UTC-3 = 15:00 UTC). */
function noonOf(dayISO) {
  return new Date(`${dayISO}T15:00:00Z`);
}

/** Dias `YYYY-MM-DD` de um mês (month = 1..12). */
function monthDays(year, month) {
  const out = [];
  const start = Date.UTC(year, month - 1, 1);
  for (let ms = start; new Date(ms).getUTCMonth() === month - 1; ms += 86400000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const key = loadEncryptionKey();
  // Caminho do banco resolvido pelo local DO SCRIPT — independe de onde é rodado
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pgdata = path.join(here, '..', '.pgdata');
  console.log(`Banco local: ${pgdata}`);
  const db = new PGlite(pgdata);
  const exec = pgliteExecutor(db);
  await runMigrations(exec);

  // Usuário: reaproveita o primeiro; se o banco estiver vazio, cria o demo.
  let user = await exec.query('SELECT id FROM app_user ORDER BY created_at LIMIT 1');
  if (user.rows.length === 0) {
    user = await exec.query(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [DEMO_EMAIL, 'Dra. Demo (Nutróloga)', hashPassword(DEMO_PASSWORD)],
    );
    console.log(`Usuário criado: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }
  const userId = user.rows[0].id;

  // Paciente: procura pelo nome decifrando (name_enc tem IV aleatório, não é buscável em SQL).
  const existing = await exec.query('SELECT id, name_enc FROM patient WHERE user_id = $1', [userId]);
  const { decryptField } = await import('@nutrimed/crypto');
  let patientId = null;
  for (const row of existing.rows) {
    try {
      if (decryptField(row.name_enc, key) === PATIENT_NAME) patientId = row.id;
    } catch {
      /* linha de outra chave — ignora */
    }
  }
  if (patientId) {
    await exec.query('DELETE FROM food_log_entry WHERE patient_id = $1', [patientId]);
    await exec.query('DELETE FROM nutrition_goal WHERE patient_id = $1', [patientId]);
    console.log(`Paciente "${PATIENT_NAME}" já existia — registros anteriores limpos.`);
  } else {
    patientId = await createPatient(
      exec,
      userId,
      { name: PATIENT_NAME, birthDate: '1990-05-14', heightCm: 178, goal: 'Recomposição corporal' },
      key,
    );
    console.log(`Paciente "${PATIENT_NAME}" criado.`);
  }

  // 12 meses terminando no mês atual.
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }

  // Metas VERSIONADAS: 2400 no início do plano, 2000 a partir da metade — o
  // histórico julga cada dia pela meta que valia nele (é o que a fase 1 preserva).
  const first = months[0];
  const mid = months[6];
  await setNutritionGoal(
    exec, patientId, userId,
    `${first.year}-${String(first.month).padStart(2, '0')}-01`,
    { kcal: 2400, protein: 150, carbs: 260, fat: 80 }, key,
  );
  await setNutritionGoal(
    exec, patientId, userId,
    `${mid.year}-${String(mid.month).padStart(2, '0')}-01`,
    { kcal: 2000, protein: 160, carbs: 200, fat: 65 }, key,
  );

  const hoje = new Date().toISOString().slice(0, 10);
  let totalDias = 0;
  let totalRegistros = 0;

  for (const [i, m] of months.entries()) {
    const goalKcal = i < 6 ? 2400 : 2000;
    // A jornada MELHORA ao longo do plano: adesão ao registro e acerto da meta
    // sobem com o tempo — é o que o médico quer mostrar ao paciente.
    const chanceRegistro = 0.35 + (i / 11) * 0.5; // 35% → 85%
    const chanceAcerto = 0.30 + (i / 11) * 0.55; // 30% → 85%

    for (const dia of monthDays(m.year, m.month)) {
      if (dia > hoje) break; // não inventa futuro
      totalDias += 1;
      if (random() > chanceRegistro) continue;

      // 1 a 3 refeições no dia, somando perto (ou longe) da meta
      const acerta = random() < chanceAcerto;
      const alvo = acerta
        ? goalKcal * (0.93 + random() * 0.14) // dentro da tolerância de 10%
        : goalKcal * (random() < 0.5 ? 0.6 + random() * 0.2 : 1.2 + random() * 0.3);
      const refeicoes = 2 + Math.floor(random() * 2);
      for (let r = 0; r < refeicoes; r += 1) {
        const fracao = r === refeicoes - 1 ? 1 : 1 / refeicoes;
        const kcal = Math.round((alvo / refeicoes) * (0.9 + random() * 0.2) * (fracao > 0 ? 1 : 1));
        await addFoodLogEntry(
          exec, patientId,
          {
            eatenAt: new Date(noonOf(dia).getTime() + r * 4 * 3600_000),
            source: random() < 0.5 ? 'telegram' : 'telegram-texto',
            values: {
              kcal,
              protein: Math.round(kcal * 0.075),
              carbs: Math.round(kcal * 0.11),
              fat: Math.round(kcal * 0.035),
              confidence: random() < 0.6 ? 'high' : 'medium',
              itemsLabel: ['arroz, frango e salada', 'pão, ovos e café', 'macarrão e carne moída', 'iogurte e frutas'][
                Math.floor(random() * 4)
              ],
            },
          },
          key,
          { action: 'seed-local' },
        );
        totalRegistros += 1;
      }
    }
  }

  console.log(`\n✅ Seed concluído`);
  console.log(`   Paciente: ${PATIENT_NAME} (${patientId})`);
  console.log(`   Período: ${months[0].year}-${String(months[0].month).padStart(2, '0')} → ${hoje}`);
  console.log(`   ${totalDias} dias no plano · ${totalRegistros} lançamentos`);
  console.log(`\n   Dashboard:    /patients/${patientId}/dashboard?aba=bem-estar`);
  console.log(`   Apresentação: /patients/${patientId}/apresentacao`);

  await db.close();
}

main().catch((err) => {
  console.error('Falha no seed:', err);
  process.exit(1);
});
