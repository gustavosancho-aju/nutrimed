/**
 * Parametrização corporal por IMC — fonte ÚNICA da morfologia usada pela
 * silhueta SVG (BodyFigure) e pelo manequim 3D (BodyFigure3D). Uma só
 * matemática garante que arrastar o slider morfa as DUAS representações
 * de forma idêntica.
 *
 * Unidades: as do viewBox histórico da silhueta (200×430, y PARA BAIXO,
 * eixo central em x=100) — os componentes convertem para o espaço deles.
 * Apoio VISUAL de apresentação — não é avaliação clínica.
 */

/** Meias-larguras (px do viewBox) derivadas do IMC — cintura/quadril crescem mais. */
export function bodyDims(imc: number) {
  // Desvio normalizado vs. o centro da faixa saudável (IMC 22):
  // t=0 → silhueta base · t=1 → IMC 40 · negativo → abaixo do peso.
  const t = Math.min(1.2, Math.max(-0.35, (imc - 22) / 18));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    t,
    shoulder: r1(34 * (1 + 0.15 * t)),
    chest: r1(30 * (1 + 0.35 * t)),
    waist: r1(24 * (1 + 0.85 * t)),
    hip: r1(30 * (1 + 0.6 * t)),
    armW: r1(9 * (1 + 0.45 * t)),
    thighW: r1(13 * (1 + 0.55 * t)),
    calfW: r1(8.5 * (1 + 0.35 * t)),
  };
}

export type BodyDims = ReturnType<typeof bodyDims>;

/** Altura do viewBox — referência para converter y-baixo ↔ y-cima. */
export const BODY_VIEW_H = 430;

/** Níveis anatômicos (y do viewBox) — os mesmos dos landmarks da silhueta. */
export const BODY_LEVELS = {
  neckBase: 72,
  shoulder: 100,
  chest: 148,
  waist: 192,
  hip: 242,
  knee: 324,
  ankle: 402,
} as const;

/** Catmull-Rom 1D: interpola suavemente raio(y) pelos pontos de controle. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

export interface TorsoProfilePoint {
  /** Raio lateral do tronco nesse nível (unidades de viewBox). */
  radius: number;
  /** Altura em y-PARA-CIMA (0 = base do viewBox, 430 = topo). */
  y: number;
}

/**
 * Perfil de revolução do TRONCO para o manequim 3D (LatheGeometry): amostra
 * suave do pescoço ao quadril, nas mesmas larguras da silhueta 2D. O corte
 * humano não é circular — o mesh aplica scale.z≈0.7 para achatar.
 */
export function torsoProfile(imc: number, samples = 28): TorsoProfilePoint[] {
  const d = bodyDims(imc);
  // Pontos de controle (y-baixo do viewBox, raio): fecha no alto do ombro e
  // afunila de leve no quadril para "assentar" nas pernas.
  const control: [number, number][] = [
    [BODY_LEVELS.neckBase, 11],
    // trapézio: ponto intermediário evita o "ombro de cabide" (salto 11→34 seco)
    [(BODY_LEVELS.neckBase + BODY_LEVELS.shoulder) / 2, 11 + (d.shoulder - 11) * 0.55],
    [BODY_LEVELS.shoulder, d.shoulder],
    [BODY_LEVELS.chest, d.chest],
    [BODY_LEVELS.waist, d.waist],
    [BODY_LEVELS.hip, d.hip],
    [BODY_LEVELS.hip + 16, d.hip * 0.82],
  ];
  const pts: TorsoProfilePoint[] = [];
  const segs = control.length - 1;
  for (let i = 0; i < samples; i += 1) {
    const s = (i / (samples - 1)) * segs;
    const seg = Math.min(segs - 1, Math.floor(s));
    const u = s - seg;
    const p0 = control[Math.max(0, seg - 1)]!;
    const p1 = control[seg]!;
    const p2 = control[seg + 1]!;
    const p3 = control[Math.min(segs, seg + 2)]!;
    const ySvg = catmullRom(p0[0], p1[0], p2[0], p3[0], u);
    const radius = Math.max(1, catmullRom(p0[1], p1[1], p2[1], p3[1], u));
    pts.push({ radius, y: BODY_VIEW_H - ySvg });
  }
  return pts;
}

/** Anéis de referência anatômica do manequim (tórax/cintura/quadril), y-para-cima. */
export function bodyRings(imc: number): { label: string; y: number; radius: number }[] {
  const d = bodyDims(imc);
  return [
    { label: 'Tórax', y: BODY_VIEW_H - BODY_LEVELS.chest, radius: d.chest },
    { label: 'Cintura', y: BODY_VIEW_H - BODY_LEVELS.waist, radius: d.waist },
    { label: 'Quadril', y: BODY_VIEW_H - BODY_LEVELS.hip, radius: d.hip },
  ];
}
