// Gera packages/taco/src/data/taco.json a partir do dataset público da TACO 4ª ed.
// (Tabela Brasileira de Composição de Alimentos, NEPA/Unicamp — domínio público).
//
// Fonte default: JSON já convertido do repositório público marcelosanto/tabela_taco
// (verificado por amostragem contra o PDF oficial da TACO 4ª ed.). Aceita também um
// arquivo local como argumento, para re-gerar sem rede:
//
//   node scripts/gen-taco.mjs [caminho-ou-url-do-TACO.json]
//
// Convenções de valor da TACO: "Tr" = traço (≈0) → 0 · "NA"/"*"/"" = não aplicável/
// não avaliado → campo omitido. Nutrientes normalizados por 100 g de parte comestível.
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_SOURCE =
  'https://raw.githubusercontent.com/marcelosanto/tabela_taco/main/TACO.json';
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'taco', 'src', 'data', 'taco.json',
);

// Mapeamento coluna TACO → nutriente exposto (por 100 g). Unidades no nome da fonte.
const NUTRIENT_COLUMNS = {
  energy_kcal: 'kcal',
  protein_g: 'protein',
  carbohydrate_g: 'carbs',
  lipid_g: 'fat',
  fiber_g: 'fiber',
  saturated_g: 'saturated',
  cholesterol_mg: 'cholesterol',
  sodium_mg: 'sodium',
  potassium_mg: 'potassium',
  calcium_mg: 'calcium',
  magnesium_mg: 'magnesium',
  iron_mg: 'iron',
  zinc_mg: 'zinc',
  vitaminC_mg: 'vitaminC',
};

function parseValue(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t === '' || t === 'NA' || t === '*') return null;
  if (/^tr$/i.test(t)) return 0; // traço: presente em quantidade não mensurável
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function loadSource(arg) {
  if (arg && !/^https?:/i.test(arg)) return readFile(arg, 'utf8');
  const url = arg ?? DEFAULT_SOURCE;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  return res.text();
}

const raw = JSON.parse(await loadSource(process.argv[2]));
if (!Array.isArray(raw)) throw new Error('Fonte inesperada: esperava um array de alimentos');

const foods = [];
let skipped = 0;
for (const item of raw) {
  const per100g = {};
  for (const [col, name] of Object.entries(NUTRIENT_COLUMNS)) {
    const v = parseValue(item[col]);
    if (v !== null && v >= 0) per100g[name] = round2(v);
  }
  // Sem kcal E sem macros o item é inutilizável para o relatório — descarta com aviso.
  if (per100g.kcal === undefined && per100g.protein === undefined) {
    skipped += 1;
    continue;
  }
  foods.push({
    id: String(item.id),
    description: String(item.description).trim(),
    category: String(item.category).trim(),
    per100g,
  });
}

foods.sort((a, b) => Number(a.id) - Number(b.id));
const out = { version: 'taco-4ed', source: DEFAULT_SOURCE, foods };
await writeFile(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`OK: ${foods.length} alimentos gravados em ${OUT} (${skipped} descartados sem kcal/proteína)`);
