// Verificação da PROJEÇÃO CORPORAL contra o Gemini real — o ponto de maior
// risco da feature: o prompt só foi exercitado pelo gerador fake, e o que
// interessa saber é (a) se o modelo aceita editar foto de pessoa real e
// (b) se ele preserva o ROSTO mudando só a silhueta. Se o rosto muda, a
// projeção perde o sentido clínico: vira a foto de outra pessoa.
//
//   npx tsx --env-file=.env scripts/poc-body-projection.mjs <foto.jpg> <pesoAtual> <pesoDesejado> [alturaCm]
//
// Provedor: BODY_PROJECTOR=gemini (default) | openai — o prompt é o MESMO nos
// dois, para que o comparativo tenha o modelo como única variável.
//
// NÃO grava nada no banco: a imagem sai num arquivo temporário FORA do repo
// (foto de paciente é dado sensível — nunca versionar). ~US$ 0,04 por chamada.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// imports relativos ao source (evitam resolução de workspace da raiz).
import { GeminiBodyProjector, buildPrompt } from '../packages/body-projection/src/gemini-projector.ts';
import { OpenAiBodyProjector } from '../packages/body-projection/src/openai-projector.ts';

const [fotoPath, pesoAtualArg, pesoDesejadoArg, alturaArg] = process.argv.slice(2);
if (!fotoPath || !pesoAtualArg || !pesoDesejadoArg) {
  console.error(
    'uso: node --experimental-strip-types --env-file=.env scripts/poc-body-projection.mjs <foto.jpg> <pesoAtual> <pesoDesejado> [alturaCm]',
  );
  process.exit(1);
}
const provedor = process.env.BODY_PROJECTOR === 'openai' ? 'openai' : 'gemini';
const apiKey = provedor === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(
    `${provedor === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} ausente — rode com --env-file=.env`,
  );
  process.exit(1);
}

const MIME_POR_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const ext = path.extname(fotoPath).toLowerCase();
const mimeType = MIME_POR_EXT[ext];
if (!mimeType) {
  console.error(`Extensão ${ext || '(nenhuma)'} não suportada — use .jpg, .png ou .webp`);
  process.exit(1);
}

const bytes = readFileSync(path.resolve(fotoPath));
const input = {
  photoBase64: bytes.toString('base64'),
  mimeType,
  currentWeightKg: Number(pesoAtualArg),
  targetWeightKg: Number(pesoDesejadoArg),
  ...(alturaArg ? { heightCm: Number(alturaArg) } : {}),
};

console.log(`Foto: ${fotoPath} (${(bytes.length / 1024).toFixed(0)} KB, ${mimeType})`);
console.log(`Projeção: ${input.currentWeightKg} kg → ${input.targetWeightKg} kg${alturaArg ? `, ${alturaArg} cm` : ''}`);
console.log(`\n--- prompt enviado ---\n${buildPrompt(input)}\n----------------------\n`);

let usage = { inputTokens: 0, outputTokens: 0 };
const config = {
  apiKey,
  ...(process.env.BODY_PROJECTOR_MODEL ? { model: process.env.BODY_PROJECTOR_MODEL } : {}),
  onUsage: (u) => {
    usage = u;
  },
};
const projector = provedor === 'openai' ? new OpenAiBodyProjector(config) : new GeminiBodyProjector(config);
console.log(`Provedor: ${provedor} (${projector.modelVersion})`);

const inicio = Date.now();
let resultado;
try {
  resultado = await projector.project(input);
} catch (err) {
  console.error(`\nFALHOU (${err.kind ?? 'erro'}): ${err.message}`);
  process.exit(1);
}
const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

const saidaExt = resultado.mimeType === 'image/jpeg' ? '.jpg' : resultado.mimeType === 'image/webp' ? '.webp' : '.png';
const dir = mkdtempSync(path.join(os.tmpdir(), 'nutrimed-projecao-'));
const destino = path.join(dir, `projecao-${input.targetWeightKg}kg${saidaExt}`);
const imagem = Buffer.from(resultado.imageBase64, 'base64');
writeFileSync(destino, imagem);

console.log(`OK em ${segundos}s  ·  modelo ${resultado.modelVersion}`);
console.log(`Imagem: ${(imagem.length / 1024).toFixed(0)} KB, ${resultado.mimeType}`);
console.log(`Salva em: ${destino}`);
// Saída de imagem: US$ 30/1M tokens no Gemini, US$ 40/1M no gpt-image-1.
const custo = (usage.outputTokens * (provedor === 'openai' ? 40 : 30)) / 1e6;
console.log(
  `\nTokens: ${usage.inputTokens} entrada / ${usage.outputTokens} saída` +
    (custo > 0 ? `  (~US$ ${custo.toFixed(4)})` : ''),
);
console.log('\nCONFIRA: o rosto continua o mesmo? roupa, pose, fundo e luz iguais? só a silhueta mudou?');
