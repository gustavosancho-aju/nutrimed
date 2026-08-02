import { describe, it, expect } from 'vitest';
import {
  bodyDims,
  torsoProfile,
  bodyRings,
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
