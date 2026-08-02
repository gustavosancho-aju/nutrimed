import { describe, it, expect } from 'vitest';
import { bodyDims } from './body-profile';

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
