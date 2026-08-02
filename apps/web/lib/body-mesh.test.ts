import { describe, it, expect } from 'vitest';
import { applyMorphs, morphWeights, parseBodyMesh, type BodyMeshData } from './body-mesh';

/** Monta um body.bin sintético (2 vértices, 1 triângulo, 1 morph). */
function fakeBin(): ArrayBuffer {
  const header = JSON.stringify({
    format: 'nutrimed-body-1',
    vertexCount: 3,
    indexCount: 3,
    morphs: [{ name: 'ganho', count: 1 }],
  });
  const hb = new TextEncoder().encode(header);
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const indices = new Uint32Array([0, 1, 2]);
  const mIdx = new Uint32Array([1]);
  const mDel = new Float32Array([5, 0, 0]);

  const total = 4 + hb.length + positions.byteLength + indices.byteLength + mIdx.byteLength + mDel.byteLength;
  const buf = new ArrayBuffer(total);
  const u8 = new Uint8Array(buf);
  new DataView(buf).setUint32(0, hb.length, true);
  let off = 4;
  u8.set(hb, off);
  off += hb.length;
  u8.set(new Uint8Array(positions.buffer), off);
  off += positions.byteLength;
  u8.set(new Uint8Array(indices.buffer), off);
  off += indices.byteLength;
  u8.set(new Uint8Array(mIdx.buffer), off);
  off += mIdx.byteLength;
  u8.set(new Uint8Array(mDel.buffer), off);
  return buf;
}

describe('parseBodyMesh — leitura do corpo compilado', () => {
  it('decodifica posições, índices e morphs esparsos', () => {
    const m = parseBodyMesh(fakeBin());
    expect(m.positions.length).toBe(9);
    expect([...m.indices]).toEqual([0, 1, 2]);
    expect([...m.morphs.ganho!.indices]).toEqual([1]);
    expect([...m.morphs.ganho!.deltas]).toEqual([5, 0, 0]);
  });

  it('recusa binário TRUNCADO (slice clampa em silêncio e viraria corpo furado)', () => {
    const cheio = fakeBin();
    const cortado = cheio.slice(0, cheio.byteLength - 8);
    expect(() => parseBodyMesh(cortado)).toThrow(/truncado/i);
  });

  it('recusa binário de formato desconhecido em vez de renderizar lixo', () => {
    const hb = new TextEncoder().encode(JSON.stringify({ format: 'outro', vertexCount: 0, indexCount: 0, morphs: [] }));
    const buf = new ArrayBuffer(4 + hb.length);
    new DataView(buf).setUint32(0, hb.length, true);
    new Uint8Array(buf).set(hb, 4);
    expect(() => parseBodyMesh(buf)).toThrow(/formato/i);
  });
});

describe('morphWeights — IMC e sexo viram pesos de deformação', () => {
  it('IMC 22 (base) não deforma; acima engorda; abaixo emagrece', () => {
    expect(morphWeights(22, 'neutro').ganho).toBe(0);
    expect(morphWeights(22, 'neutro').perda).toBe(0);
    expect(morphWeights(35, 'neutro').ganho).toBeGreaterThan(0);
    expect(morphWeights(35, 'neutro').perda).toBe(0);
    expect(morphWeights(17, 'neutro').perda).toBeGreaterThan(0);
    expect(morphWeights(17, 'neutro').ganho).toBe(0);
  });

  it('ganho é monotônico no IMC e satura (sem corpo impossível)', () => {
    const a = morphWeights(28, 'neutro').ganho;
    const b = morphWeights(38, 'neutro').ganho;
    const teto = morphWeights(90, 'neutro').ganho;
    expect(b).toBeGreaterThan(a!);
    expect(teto).toBeLessThanOrEqual(3.4);
  });

  it('o sexo liga um único morph por vez (neutro não liga nenhum)', () => {
    expect(morphWeights(25, 'feminino')).toMatchObject({ feminino: 1, masculino: 0 });
    expect(morphWeights(25, 'masculino')).toMatchObject({ feminino: 0, masculino: 1 });
    expect(morphWeights(25, 'neutro')).toMatchObject({ feminino: 0, masculino: 0 });
  });
});

describe('applyMorphs — deformação sobre o corpo base', () => {
  const mesh: BodyMeshData = {
    positions: new Float32Array([0, 0, 0, 10, 0, 0]),
    indices: new Uint32Array([0, 1, 0]),
    morphs: {
      ganho: { indices: new Uint32Array([1]), deltas: new Float32Array([4, 0, 0]) },
    },
  };

  it('peso 0 devolve o corpo base intacto', () => {
    const out = applyMorphs(mesh, { ganho: 0 }, new Float32Array(6));
    expect([...out]).toEqual([0, 0, 0, 10, 0, 0]);
  });

  it('peso escala o delta e só toca os vértices do morph', () => {
    const out = applyMorphs(mesh, { ganho: 2 }, new Float32Array(6));
    expect([...out]).toEqual([0, 0, 0, 18, 0, 0]);
  });

  it('reusar o buffer não acumula deformação entre chamadas', () => {
    const buf = new Float32Array(6);
    applyMorphs(mesh, { ganho: 1 }, buf);
    applyMorphs(mesh, { ganho: 1 }, buf);
    expect(buf[3]).toBe(14); // 10 + 4, não 10 + 4 + 4
  });

  it('morph inexistente é ignorado (asset antigo não quebra a tela)', () => {
    const out = applyMorphs(mesh, { inexistente: 1 }, new Float32Array(6));
    expect([...out]).toEqual([0, 0, 0, 10, 0, 0]);
  });
});
