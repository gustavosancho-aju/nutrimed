import { describe, it, expect } from 'vitest';
import {
  bodyDims,
  torsoProfile,
  bodyRings,
  buildTorsoGeometry,
  BODY_LEVELS,
  BODY_VIEW_H,
} from './body-profile';

describe('bodyDims — morfologia paramétrica por IMC (fonte única SVG + 3D)', () => {
  it('valores de referência da silhueta base (IMC 22) não mudam sem intenção', () => {
    const d = bodyDims(22);
    expect(d.t).toBe(0);
    expect(d.shoulder).toBe(34);
    expect(d.chest).toBe(30);
    expect(d.waist).toBe(24);
    expect(d.hip).toBe(30);
  });

  it('cintura e quadril crescem monotonicamente com o IMC', () => {
    const imcs = [17, 22, 28, 34, 40];
    for (let i = 1; i < imcs.length; i += 1) {
      expect(bodyDims(imcs[i]!).waist).toBeGreaterThan(bodyDims(imcs[i - 1]!).waist);
      expect(bodyDims(imcs[i]!).hip).toBeGreaterThan(bodyDims(imcs[i - 1]!).hip);
    }
  });

  it('a cintura cresce MAIS que o ombro (aproxima a mudança real de composição)', () => {
    const base = bodyDims(22);
    const alto = bodyDims(40);
    const cresceCintura = alto.waist / base.waist;
    const cresceOmbro = alto.shoulder / base.shoulder;
    expect(cresceCintura).toBeGreaterThan(cresceOmbro);
  });

  it('clampa nos extremos: IMC 10 == piso, IMC 60 == teto (sem silhueta absurda)', () => {
    expect(bodyDims(10)).toEqual(bodyDims(15.7)); // t = -0.35 nos dois
    expect(bodyDims(60)).toEqual(bodyDims(43.6)); // t = 1.2 nos dois
  });
});

describe('torsoProfile — perfil de revolução do manequim 3D', () => {
  it('amostra do pescoço ao quadril, raios positivos e y para CIMA decrescente', () => {
    const pts = torsoProfile(30);
    expect(pts.length).toBe(28);
    for (const p of pts) expect(p.radius).toBeGreaterThan(0);
    // primeiro ponto no pescoço (topo do tronco), último abaixo do quadril
    expect(pts[0]!.y).toBeCloseTo(BODY_VIEW_H - BODY_LEVELS.neckBase, 0);
    expect(pts[pts.length - 1]!.y).toBeLessThan(BODY_VIEW_H - BODY_LEVELS.hip + 1);
    for (let i = 1; i < pts.length; i += 1) {
      expect(pts[i]!.y).toBeLessThanOrEqual(pts[i - 1]!.y);
    }
  });

  it('o perfil passa (aprox.) pelas larguras canônicas de tórax e cintura', () => {
    const imc = 34;
    const d = bodyDims(imc);
    const pts = torsoProfile(imc, 80);
    const nearest = (ySvg: number) =>
      pts.reduce((a, b) =>
        Math.abs(b.y - (BODY_VIEW_H - ySvg)) < Math.abs(a.y - (BODY_VIEW_H - ySvg)) ? b : a,
      );
    expect(nearest(BODY_LEVELS.chest).radius).toBeCloseTo(d.chest, 0);
    expect(nearest(BODY_LEVELS.waist).radius).toBeCloseTo(d.waist, 0);
  });

  it('um IMC maior produz perfil estritamente mais largo na cintura', () => {
    const magro = torsoProfile(20, 40);
    const largo = torsoProfile(38, 40);
    const cinturaY = BODY_VIEW_H - BODY_LEVELS.waist;
    const at = (pts: typeof magro) =>
      pts.reduce((a, b) => (Math.abs(b.y - cinturaY) < Math.abs(a.y - cinturaY) ? b : a));
    expect(at(largo).radius).toBeGreaterThan(at(magro).radius);
  });
});

describe('bodyDims — dimorfismo sexual (padrão clínico de distribuição)', () => {
  it('feminino: quadril > ombro; masculino: ombro > quadril (IMC 22)', () => {
    const f = bodyDims(22, 'feminino');
    const m = bodyDims(22, 'masculino');
    expect(f.hip).toBeGreaterThan(f.shoulder);
    expect(m.shoulder).toBeGreaterThan(m.hip);
  });

  it('gordura androide vs ginoide: com IMC alto a CINTURA masculina cresce mais e o QUADRIL feminino cresce mais', () => {
    const cresce = (sex: Parameters<typeof bodyDims>[1], campo: 'waist' | 'hip') =>
      bodyDims(40, sex)[campo] / bodyDims(22, sex)[campo];
    expect(cresce('masculino', 'waist')).toBeGreaterThan(cresce('feminino', 'waist'));
    expect(cresce('feminino', 'hip')).toBeGreaterThan(cresce('masculino', 'hip'));
  });

  it("default 'neutro' preserva a silhueta histórica (compatibilidade com o SVG)", () => {
    expect(bodyDims(28)).toEqual(bodyDims(28, 'neutro'));
  });
});

describe('buildTorsoGeometry — seções assimétricas (peitoral/costas/barriga/glúteo)', () => {
  /** Extremos de z no anel mais próximo de um nível anatômico (y do viewBox). */
  function zAtLevel(imc: number, sex: Parameters<typeof bodyDims>[1], ySvg: number) {
    const rings = 36;
    const segments = 48;
    const { positions } = buildTorsoGeometry(imc, sex, rings, segments);
    const target = BODY_VIEW_H - ySvg;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rings; i += 1) {
      const y = positions[(i * segments) * 3 + 1]!;
      const d = Math.abs(y - target);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    let zMax = -Infinity;
    let zMin = Infinity;
    for (let j = 0; j < segments; j += 1) {
      const z = positions[(best * segments + j) * 3 + 2]!;
      if (z > zMax) zMax = z;
      if (z < zMin) zMin = z;
    }
    return { front: zMax, back: -zMin };
  }

  it('a malha é fechada e sã: contagens certas, índices válidos, sem NaN', () => {
    const rings = 36;
    const segments = 48;
    const { positions, indices } = buildTorsoGeometry(30, 'neutro', rings, segments);
    expect(positions.length).toBe((rings * segments + 2) * 3);
    expect(indices.length).toBe((rings - 1) * segments * 6 + segments * 6);
    const nVerts = positions.length / 3;
    for (const idx of indices) expect(idx).toBeLessThan(nVerts);
    for (const v of positions) expect(Number.isNaN(v)).toBe(false);
  });

  it('frente ≠ costas: no nível do peito o tronco projeta mais para FRENTE que para trás', () => {
    const { front, back } = zAtLevel(24, 'masculino', BODY_LEVELS.chest);
    expect(front).toBeGreaterThan(back);
  });

  it('busto feminino projeta mais que o peitoral masculino no nível do peito', () => {
    const f = zAtLevel(24, 'feminino', BODY_LEVELS.chest);
    const m = zAtLevel(24, 'masculino', BODY_LEVELS.chest);
    expect(f.front).toBeGreaterThan(m.front);
  });

  it('glúteo: no quadril as COSTAS femininas projetam mais que as masculinas', () => {
    const f = zAtLevel(24, 'feminino', BODY_LEVELS.hip);
    const m = zAtLevel(24, 'masculino', BODY_LEVELS.hip);
    expect(f.back).toBeGreaterThan(m.back);
  });

  it('barriga cresce para FRENTE com o IMC, e mais no masculino (androide)', () => {
    const magro = zAtLevel(22, 'masculino', BODY_LEVELS.waist);
    const largo = zAtLevel(40, 'masculino', BODY_LEVELS.waist);
    expect(largo.front).toBeGreaterThan(magro.front * 1.3);
    const cresceM = zAtLevel(40, 'masculino', BODY_LEVELS.waist).front / magro.front;
    const cresceF =
      zAtLevel(40, 'feminino', BODY_LEVELS.waist).front /
      zAtLevel(22, 'feminino', BODY_LEVELS.waist).front;
    expect(cresceM).toBeGreaterThan(cresceF);
  });
});

describe('bodyRings — anéis anatômicos do manequim', () => {
  it('3 anéis (tórax/cintura/quadril) nos níveis certos, raio = meia-largura do nível', () => {
    const rings = bodyRings(28);
    const d = bodyDims(28);
    expect(rings.map((r) => r.label)).toEqual(['Tórax', 'Cintura', 'Quadril']);
    expect(rings[0]!.radius).toBe(d.chest);
    expect(rings[1]!.radius).toBe(d.waist);
    expect(rings[2]!.radius).toBe(d.hip);
    expect(rings[1]!.y).toBe(BODY_VIEW_H - BODY_LEVELS.waist);
  });
});
