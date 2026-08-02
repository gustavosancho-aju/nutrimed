import type { BodySex } from './body-profile';

/**
 * Carrega e deforma o corpo humano do Modo Apresentação.
 *
 * O mesh é escultura de artista (MakeHuman, CC0) compilada por
 * `scripts/build-body-mesh.mjs` em `public/models/body.bin` — primitivas
 * procedurais produzem um boneco, não um corpo. Os morphs são ESPARSOS
 * (só os vértices que cada target move) e aplicados na CPU: recalcular 13k
 * vértices leva menos de 1 ms e só acontece quando o IMC ou o sexo mudam,
 * nunca por frame.
 */

export interface BodyMorph {
  indices: Uint32Array;
  /** dx,dy,dz por índice (mesmo comprimento/3 de `indices`). */
  deltas: Float32Array;
}

export interface BodyMeshData {
  positions: Float32Array;
  indices: Uint32Array;
  morphs: Record<string, BodyMorph>;
}

interface BodyHeader {
  format: string;
  vertexCount: number;
  indexCount: number;
  morphs: { name: string; count: number }[];
}

/** Lê o binário do corpo (ver formato no cabeçalho do script de build). */
export function parseBodyMesh(buffer: ArrayBuffer): BodyMeshData {
  const view = new DataView(buffer);
  const headerLen = view.getUint32(0, true);
  const header: BodyHeader = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen)),
  );
  if (!header.format?.startsWith('nutrimed-body-')) {
    throw new Error('body.bin: formato desconhecido');
  }

  // Download truncado precisa FALHAR aqui: ArrayBuffer.slice clampa em vez de
  // lançar, então um binário incompleto viraria um corpo com vértices zerados
  // (uma mancha no palco) em vez de cair no fallback SVG.
  const esperado =
    4 +
    headerLen +
    header.vertexCount * 12 +
    header.indexCount * 4 +
    header.morphs.reduce((soma, m) => soma + m.count * 16, 0);
  if (buffer.byteLength < esperado) {
    throw new Error(
      `body.bin: truncado (${buffer.byteLength} bytes, esperado ${esperado})`,
    );
  }

  let off = 4 + headerLen;
  const positions = new Float32Array(buffer.slice(off, off + header.vertexCount * 12));
  off += header.vertexCount * 12;
  const indices = new Uint32Array(buffer.slice(off, off + header.indexCount * 4));
  off += header.indexCount * 4;

  const morphs: Record<string, BodyMorph> = {};
  for (const m of header.morphs) {
    const idx = new Uint32Array(buffer.slice(off, off + m.count * 4));
    off += m.count * 4;
    const del = new Float32Array(buffer.slice(off, off + m.count * 12));
    off += m.count * 12;
    morphs[m.name] = { indices: idx, deltas: del };
  }
  return { positions, indices, morphs };
}

/** IMC de referência: o corpo base do MakeHuman é ~saudável. */
const BASE_IMC = 22;

/**
 * Pesos dos morphs para um estado (IMC + sexo). Ganho e perda são morphs
 * distintos porque os targets do MakeHuman são direcionais — interpolar um
 * pelo negativo do outro distorce o corpo.
 */
export function morphWeights(imc: number, sex: BodySex): Record<string, number> {
  const delta = imc - BASE_IMC;
  /*
   * AMPLITUDE: os targets de circunferência do MakeHuman são de ajuste FINO
   * (peso 1 ≈ um passo de slider, não um corpo obeso). Para cobrir de IMC 22
   * a 40+ o peso precisa ir bem além de 1 — calibrado no navegador comparando
   * a silhueta com as faixas da OMS.
   */
  return {
    ganho: delta > 0 ? Math.min(3.4, (delta / 18) * 2.6) : 0,
    perda: delta < 0 ? Math.min(1.8, (-delta / 7) * 1.5) : 0,
    feminino: sex === 'feminino' ? 1 : 0,
    masculino: sex === 'masculino' ? 1 : 0,
  };
}

/**
 * Aplica os morphs sobre as posições base, escrevendo em `out` (reusa o
 * buffer entre chamadas — o slider dispara isso a cada movimento).
 */
export function applyMorphs(
  mesh: BodyMeshData,
  weights: Record<string, number>,
  out: Float32Array,
): Float32Array {
  out.set(mesh.positions);
  for (const [name, w] of Object.entries(weights)) {
    if (!w) continue;
    const morph = mesh.morphs[name];
    if (!morph) continue;
    const { indices, deltas } = morph;
    for (let k = 0; k < indices.length; k += 1) {
      const v = indices[k]! * 3;
      out[v] = out[v]! + deltas[k * 3]! * w;
      out[v + 1] = out[v + 1]! + deltas[k * 3 + 1]! * w;
      out[v + 2] = out[v + 2]! + deltas[k * 3 + 2]! * w;
    }
  }
  return out;
}

/** Baixa e decodifica o corpo (uma vez por sessão — o browser cacheia). */
export async function loadBodyMesh(url = '/models/body.bin'): Promise<BodyMeshData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`body.bin: HTTP ${res.status}`);
  return parseBodyMesh(await res.arrayBuffer());
}
