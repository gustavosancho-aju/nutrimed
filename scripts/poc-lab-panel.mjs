// Verificação do extrator de PAINEL LABORATORIAL completo (E14) contra um laudo
// REAL — o ponto de maior risco da feature: o prompt do painel só foi exercitado
// pelo extrator fake, e o que interessa é se o modelo lê TODOS os analitos de um
// laudo de dezenas de páginas e escolhe a faixa de referência certa (o laudo
// lista faixas por sexo e idade).
//
//   node --experimental-strip-types --env-file=.env scripts/poc-lab-panel.mjs <laudo.pdf>
//
// NÃO grava nada: só imprime o que seria mostrado ao médico na tela de
// confirmação, já canonicalizado pelo catálogo e com a faixa interpretada.
// O PDF é enviado à Messages API da Anthropic (mesmo caminho da importação real).
import { readFileSync } from 'node:fs';
import path from 'node:path';
// imports relativos ao source (evitam resolução de workspace da raiz); requer
// `node --experimental-strip-types` (Node 22+) para carregar os .ts diretamente.
import { ClaudeLabExtractor } from '../packages/lab-import/src/claude-extractor.ts';
import { matchAnalyte, parseReferenceRange, formatRange } from '../packages/lab-catalog/src/index.ts';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('uso: node --experimental-strip-types --env-file=.env scripts/poc-lab-panel.mjs <laudo.pdf>');
  process.exit(1);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY ausente — rode com --env-file=.env');
  process.exit(1);
}

const base64 = readFileSync(path.resolve(pdfPath)).toString('base64');
console.log(`Laudo: ${pdfPath} (${(base64.length / 1024 / 1.37).toFixed(0)} KB)`);

let usage = { inputTokens: 0, outputTokens: 0 };
const extractor = new ClaudeLabExtractor({
  apiKey,
  model: process.env.LAB_MODEL ?? 'claude-haiku-4-5',
  onUsage: (u) => {
    usage = u;
  },
});

const inicio = Date.now();
const panel = await extractor.extractPanel({ base64, filename: path.basename(pdfPath) });
const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

console.log(`\nColeta: ${panel.measuredAt ?? '(não lida)'}`);
console.log(`Analitos lidos: ${panel.analytes.length}  ·  ${segundos}s`);
if (panel.notes) console.log(`Notas do extrator: ${panel.notes}`);

let reconhecidos = 0;
let comFaixa = 0;
let comHistorico = 0;
const livres = [];

console.log('\n' + '─'.repeat(112));
console.log(
  'EXAME (canônico)'.padEnd(30) + 'VALOR'.padEnd(14) + 'FAIXA LIDA'.padEnd(20) + 'HIST'.padEnd(6) + 'NOME NO LAUDO',
);
console.log('─'.repeat(112));

for (const a of panel.analytes) {
  const def = matchAnalyte(a.rawName);
  const range = parseReferenceRange(a.referenceText);
  const faixa = formatRange(range, a.unit ?? def?.unit);
  if (def) reconhecidos += 1;
  else livres.push(a.rawName);
  if (faixa) comFaixa += 1;
  const hist = a.history?.length ?? 0;
  if (hist) comHistorico += 1;

  const rotulo = def ? def.label : `${a.rawName} (livre)`;
  console.log(
    rotulo.slice(0, 29).padEnd(30) +
      `${a.value}${a.unit ? ' ' + a.unit : ''}`.slice(0, 13).padEnd(14) +
      (faixa ?? '—').slice(0, 19).padEnd(20) +
      String(hist || '—').padEnd(6) +
      a.rawName.slice(0, 40),
  );
}

console.log('─'.repeat(112));
console.log(
  `\nReconhecidos pelo catálogo: ${reconhecidos}/${panel.analytes.length}` +
    `  ·  com faixa interpretada: ${comFaixa}/${panel.analytes.length}` +
    `  ·  com histórico: ${comHistorico}`,
);

// Linhas distintas do laudo que caem no MESMO slug (ex.: as duas estimativas de
// RFG). Na gravação, `resolveSlugCollisions` mantém a primeira no slug canônico
// e rebaixa as demais a exame livre — aqui só reportamos, para dar visibilidade.
const porSlug = new Map();
for (const a of panel.analytes) {
  const slug = matchAnalyte(a.rawName)?.slug;
  if (!slug) continue;
  porSlug.set(slug, [...(porSlug.get(slug) ?? []), a.rawName]);
}
const colisoes = [...porSlug.entries()].filter(([, nomes]) => nomes.length > 1);
if (colisoes.length) {
  console.log('\nColisões de slug (serão separadas na gravação):');
  for (const [slug, nomes] of colisoes) console.log(`  ${slug}: ${nomes.join('  |  ')}`);
}
if (livres.length) console.log(`\nEntraram como exame LIVRE (fora do catálogo):\n  - ${livres.join('\n  - ')}`);
console.log(
  `\nTokens: ${usage.inputTokens} entrada / ${usage.outputTokens} saída` +
    `  (~US$ ${((usage.inputTokens * 1) / 1e6 + (usage.outputTokens * 5) / 1e6).toFixed(4)} no Haiku)`,
);
