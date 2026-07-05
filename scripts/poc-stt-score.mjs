// Harness da POC 2.5 (Transcrição Confiável, Story 3): pontua configurações de STT
// por RECALL de termo clínico (métrica primária) e WER (contexto), sobre pares
// (referência humana, hipótese do STT). Reusa as métricas testadas de @nutrimed/domain.
//
//   node --experimental-strip-types scripts/poc-stt-score.mjs <manifest.json>
//
// manifest.json:
// {
//   "samples": [
//     { "reference": "poc/ref/01.txt",
//       "hypotheses": { "nova2-keywords": "poc/hyp/01-a.txt", "nova3-keyterm": "poc/hyp/01-b.txt" } }
//   ]
// }
// Cada arquivo é texto puro (uma consulta). Colete a referência revisando o transcript
// (a própria feature de Transcrição Confiável serve de ground truth) e as hipóteses
// rodando cada configuração do adapter (buildListenUrl escolhe keyterm no nova-3).
import { readFileSync } from 'node:fs';
import path from 'node:path';
// import relativo ao source (evita resolução de workspace da raiz); requer
// `node --experimental-strip-types` (Node 22+) para carregar os .ts diretamente.
import { CLINICAL_VOCABULARY } from '../packages/domain/src/clinical-vocabulary.ts';
import { scoreTranscript } from '../packages/domain/src/stt-accuracy.ts';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('uso: node --experimental-strip-types scripts/poc-stt-score.mjs <manifest.json>');
  process.exit(1);
}
const baseDir = path.dirname(path.resolve(manifestPath));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const read = (p) => readFileSync(path.resolve(baseDir, p), 'utf8');

/** Agrega por configuração: recall médio, WER médio, termos perdidos (frequência). */
const agg = new Map();
for (const sample of manifest.samples) {
  const reference = read(sample.reference);
  for (const [config, hypPath] of Object.entries(sample.hypotheses)) {
    const s = scoreTranscript(reference, read(hypPath), CLINICAL_VOCABULARY);
    if (!agg.has(config)) agg.set(config, { n: 0, recall: 0, wer: 0, expected: 0, found: 0, missed: new Map() });
    const a = agg.get(config);
    a.n += 1;
    a.recall += s.termRecall.recall;
    a.wer += s.wer;
    a.expected += s.termRecall.expected;
    a.found += s.termRecall.found;
    for (const term of s.termRecall.missed) a.missed.set(term, (a.missed.get(term) ?? 0) + 1);
  }
}

console.log(`\nPOC 2.5 — ${manifest.samples.length} amostra(s) · ${CLINICAL_VOCABULARY.length} termos no vocabulário\n`);
for (const [config, a] of agg) {
  const recallGlobal = a.expected === 0 ? 1 : a.found / a.expected;
  console.log(`▸ ${config}`);
  console.log(`   recall clínico (por termo): ${(recallGlobal * 100).toFixed(1)}%  (${a.found}/${a.expected} termos)`);
  console.log(`   recall clínico (média/amostra): ${((a.recall / a.n) * 100).toFixed(1)}%`);
  console.log(`   WER médio: ${((a.wer / a.n) * 100).toFixed(1)}%`);
  const missed = [...a.missed.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
  if (missed.length) console.log(`   termos mais perdidos: ${missed.map(([t, c]) => `${t}×${c}`).join(', ')}`);
  console.log();
}
console.log('Decisão: escolher a configuração com MAIOR recall clínico (a métrica de confiança);');
console.log('o WER desempata. Meta sugerida p/ produção: recall clínico ≥ 95%.\n');
