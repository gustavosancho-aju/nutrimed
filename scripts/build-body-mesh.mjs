/**
 * Compila o corpo humano do Modo Apresentação a partir dos assets CC0 do
 * MakeHuman (base mesh + targets), gerando UM binário compacto que o navegador
 * carrega sob demanda.
 *
 * Por que existe: primitivas procedurais (esferas/cápsulas) não produzem um
 * corpo humano — só um boneco. O mesh do MakeHuman é escultura de artista
 * (19k vértices) e foi liberado como CC0 em setembro de 2020, então pode ser
 * embarcado sem obrigação de licença (a atribuição fica no README do asset por
 * cortesia, não por exigência).
 *
 * Entrada (baixada do repositório oficial, NÃO versionada):
 *   makehuman/data/3dobjs/base.obj          — mesh androgíneo
 *   makehuman/data/targets/**.target        — deltas de vértice (texto)
 *
 * Saída: apps/web/public/models/body.bin (formato próprio, ver HEADER abaixo).
 * Morphs ESPARSOS (só os vértices que o target move) — o .target já é esparso,
 * e densificar quadruplicaria o download sem ganho.
 *
 * Uso:
 *   node scripts/build-body-mesh.mjs <dir-com-base.obj-e-t/>
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2];
if (!SRC) {
  console.error('uso: node scripts/build-body-mesh.mjs <dir-com-base.obj-e-t/>');
  process.exit(1);
}

/** Altura-alvo do corpo no espaço do palco (mesmo viewBox da silhueta 2D). */
const TARGET_HEIGHT = 430;

/* ------------------------------------------------------------------ mesh -- */

console.log('lendo base.obj…');
const obj = readFileSync(join(SRC, 'base.obj'), 'utf8');

/** Todos os vértices do arquivo (índice 1-based no .obj). */
const allVerts = [];
/** Faces do grupo `body` (quads e triângulos), em índices 0-based. */
const bodyFaces = [];
let inBody = false;

for (const line of obj.split('\n')) {
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.split(/\s+/);
    allVerts.push([Number(x), Number(y), Number(z)]);
  } else if (line.startsWith('g ')) {
    // só o corpo: helper-* (roupas) e joint-* (cubos de rig) ficam de fora
    inBody = line.trim() === 'g body';
  } else if (inBody && line.startsWith('f ')) {
    const idx = line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((tok) => Number(tok.split('/')[0]) - 1);
    bodyFaces.push(idx);
  }
}
console.log(`  ${allVerts.length} vértices no arquivo · ${bodyFaces.length} faces no grupo body`);

// Vértices realmente usados pelo corpo → array compacto + mapa de remapeamento
const used = new Set();
for (const f of bodyFaces) for (const i of f) used.add(i);
const bodyIdx = [...used].sort((a, b) => a - b);
const remap = new Map(bodyIdx.map((orig, novo) => [orig, novo]));
console.log(`  ${bodyIdx.length} vértices pertencem ao corpo`);

// Triangulação (fan) — WebGL não desenha quads
const tris = [];
for (const f of bodyFaces) {
  for (let k = 1; k + 1 < f.length; k += 1) {
    tris.push(remap.get(f[0]), remap.get(f[k]), remap.get(f[k + 1]));
  }
}
console.log(`  ${tris.length / 3} triângulos`);

/* ------------------------------------------------------- normalização -- */

let minY = Infinity;
let maxY = -Infinity;
let sumX = 0;
let sumZ = 0;
for (const i of bodyIdx) {
  const v = allVerts[i];
  if (v[1] < minY) minY = v[1];
  if (v[1] > maxY) maxY = v[1];
  sumX += v[0];
  sumZ += v[2];
}
const scale = TARGET_HEIGHT / (maxY - minY);
const cx = sumX / bodyIdx.length;
const cz = sumZ / bodyIdx.length;
console.log(`  altura original ${(maxY - minY).toFixed(3)} ⇒ escala ${scale.toFixed(2)}`);

/** Converte um vértice do espaço MakeHuman para o espaço do palco. */
const toStage = (v) => [(v[0] - cx) * scale, (v[1] - minY) * scale, (v[2] - cz) * scale];

const positions = new Float32Array(bodyIdx.length * 3);
bodyIdx.forEach((orig, novo) => {
  const [x, y, z] = toStage(allVerts[orig]);
  positions[novo * 3] = x;
  positions[novo * 3 + 1] = y;
  positions[novo * 3 + 2] = z;
});

/* ----------------------------------------------------------- targets -- */

/** Lê um .target: linhas `índice dx dy dz`, já remapeadas e escaladas. */
function readTarget(nome) {
  const txt = readFileSync(join(SRC, 't', `${nome}.target`), 'utf8');
  const out = new Map();
  for (const line of txt.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [i, dx, dy, dz] = line.trim().split(/\s+/).map(Number);
    const novo = remap.get(i);
    if (novo === undefined) continue; // delta em helper/joint — fora do corpo
    out.set(novo, [dx * scale, dy * scale, dz * scale]);
  }
  return out;
}

/** Soma targets com pesos num único morph (Map índice → delta acumulado). */
function combine(partes) {
  const acc = new Map();
  for (const [nome, peso] of partes) {
    let t;
    try {
      t = readTarget(nome);
    } catch {
      console.warn(`  ! target ausente, ignorado: ${nome}`);
      continue;
    }
    for (const [i, d] of t) {
      const a = acc.get(i) ?? [0, 0, 0];
      acc.set(i, [a[0] + d[0] * peso, a[1] + d[1] * peso, a[2] + d[2] * peso]);
    }
  }
  return acc;
}

/**
 * Morphs semânticos do NutriMed. O peso NÃO é um target único do MakeHuman:
 * é a soma das circunferências que de fato mudam com a adiposidade, na
 * proporção clínica — cintura e abdômen lideram, extremidades acompanham de
 * leve. Ganho e perda são morphs separados porque os targets do MakeHuman
 * são direcionais (incr/decr não são simétricos).
 */
const MORPHS = {
  ganho: [
    ['measure-waist-circ-incr', 1.0],
    ['stomach-pregnant-incr', 0.55],
    ['measure-hips-circ-incr', 0.8],
    ['measure-bust-circ-incr', 0.6],
    ['measure-underbust-circ-incr', 0.7],
    ['measure-thigh-circ-incr', 0.7],
    ['measure-upperarm-circ-incr', 0.6],
    ['measure-neck-circ-incr', 0.45],
    ['measure-calf-circ-incr', 0.4],
    ['measure-knee-circ-incr', 0.3],
    ['buttocks-volume-incr', 0.4],
  ],
  perda: [
    ['measure-waist-circ-decr', 1.0],
    ['measure-hips-circ-decr', 0.7],
    ['measure-bust-circ-decr', 0.5],
    ['measure-thigh-circ-decr', 0.6],
    ['measure-upperarm-circ-decr', 0.5],
  ],
  feminino: [['caucasian-female-young', 1.0]],
  masculino: [['caucasian-male-young', 1.0]],
};

const morphs = {};
for (const [nome, partes] of Object.entries(MORPHS)) {
  const m = combine(partes);
  morphs[nome] = m;
  console.log(`  morph "${nome}": ${m.size} vértices afetados`);
}

/* -------------------------------------------------------------- saída -- */

/*
 * FORMATO body.bin (little-endian):
 *   [0]  uint32  tamanho do header JSON (bytes)
 *   [4]  utf8    header JSON: { vertexCount, indexCount, morphs:[{name,count}] }
 *   ...  float32 positions   (vertexCount * 3)
 *   ...  uint32  indices     (indexCount)
 *   ...  por morph: uint32 indices[count] + float32 deltas[count*3]
 */
const header = {
  format: 'nutrimed-body-1',
  source: 'MakeHuman base mesh + targets (CC0, set/2020)',
  vertexCount: positions.length / 3,
  indexCount: tris.length,
  morphs: Object.entries(morphs).map(([name, m]) => ({ name, count: m.size })),
};
const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');

const chunks = [];
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
chunks.push(u32(headerBytes.length), headerBytes);
chunks.push(Buffer.from(positions.buffer));
chunks.push(Buffer.from(new Uint32Array(tris).buffer));
for (const m of Object.values(morphs)) {
  const idx = new Uint32Array(m.size);
  const del = new Float32Array(m.size * 3);
  let k = 0;
  for (const [i, d] of m) {
    idx[k] = i;
    del[k * 3] = d[0];
    del[k * 3 + 1] = d[1];
    del[k * 3 + 2] = d[2];
    k += 1;
  }
  chunks.push(Buffer.from(idx.buffer), Buffer.from(del.buffer));
}

const outDir = join(ROOT, 'apps/web/public/models');
mkdirSync(outDir, { recursive: true });
const out = Buffer.concat(chunks);
writeFileSync(join(outDir, 'body.bin'), out);
console.log(`\n✓ apps/web/public/models/body.bin — ${(out.length / 1024).toFixed(0)} KB`);
console.log(`  (${readdirSync(join(SRC, 't')).length} targets combinados)`);
