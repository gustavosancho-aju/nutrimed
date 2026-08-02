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

/**
 * Sexo do manequim (opção do MÉDICO no palco, não dado do cadastro): 'neutro'
 * preserva a silhueta histórica — ninguém é forçado a escolher. O dimorfismo
 * segue o padrão clínico de DISTRIBUIÇÃO de gordura: androide (abdômen) no
 * masculino, ginoide (quadril/coxas) no feminino.
 */
export type BodySex = 'neutro' | 'feminino' | 'masculino';

/** Fatores de dimorfismo: [base, crescimentoComT] multiplicam cada largura. */
const SEX_FACTORS: Record<
  BodySex,
  { shoulder: number; chest: number; waistBase: number; waistGrow: number; hipBase: number; hipGrow: number; thigh: number; arm: number }
> = {
  neutro: { shoulder: 1, chest: 1, waistBase: 1, waistGrow: 1, hipBase: 1, hipGrow: 1, thigh: 1, arm: 1 },
  masculino: { shoulder: 1.08, chest: 1.05, waistBase: 1.04, waistGrow: 1.18, hipBase: 0.94, hipGrow: 0.9, thigh: 0.97, arm: 1.06 },
  feminino: { shoulder: 0.92, chest: 0.97, waistBase: 0.9, waistGrow: 0.78, hipBase: 1.08, hipGrow: 1.12, thigh: 1.05, arm: 0.92 },
};

/** Meias-larguras (px do viewBox) derivadas do IMC — cintura/quadril crescem mais. */
export function bodyDims(imc: number, sex: BodySex = 'neutro') {
  // Desvio normalizado vs. o centro da faixa saudável (IMC 22):
  // t=0 → silhueta base · t=1 → IMC 40 · negativo → abaixo do peso.
  const t = Math.min(1.2, Math.max(-0.35, (imc - 22) / 18));
  const f = SEX_FACTORS[sex];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    t,
    shoulder: r1(34 * f.shoulder * (1 + 0.15 * t)),
    chest: r1(30 * f.chest * (1 + 0.35 * t)),
    waist: r1(24 * f.waistBase * (1 + 0.85 * f.waistGrow * t)),
    hip: r1(30 * f.hipBase * (1 + 0.6 * f.hipGrow * t)),
    armW: r1(9 * f.arm * (1 + 0.45 * t)),
    thighW: r1(13 * f.thigh * (1 + 0.55 * t)),
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
export function torsoProfile(imc: number, samples = 28, sex: BodySex = 'neutro'): TorsoProfilePoint[] {
  const d = bodyDims(imc, sex);
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
    [BODY_LEVELS.hip + 16, d.hip * 0.72],
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
export function bodyRings(imc: number, sex: BodySex = 'neutro'): { label: string; y: number; radius: number }[] {
  const d = bodyDims(imc, sex);
  return [
    { label: 'Tórax', y: BODY_VIEW_H - BODY_LEVELS.chest, radius: d.chest },
    { label: 'Cintura', y: BODY_VIEW_H - BODY_LEVELS.waist, radius: d.waist },
    { label: 'Quadril', y: BODY_VIEW_H - BODY_LEVELS.hip, radius: d.hip },
  ];
}

/* ------------------------------------------------------------------------- *
 * Escultura do TRONCO 3D por seções transversais ASSIMÉTRICAS.
 *
 * O lathe (revolução) era simétrico por construção — sem peitoral, sem
 * costas, sem barriga que projeta para FRENTE. Aqui cada anel é uma seção
 * "ovo": semi-eixo lateral = largura canônica (bodyDims), frente e costas
 * com profundidades PRÓPRIAS (dF/dB), deslocamento do centro (zC = curvatura
 * de coluna/postura) e um expoente de forma (p: <1 achata o peito em "placa"
 * masculina, >1 aponta o busto feminino). A gordura segue o padrão clínico:
 * androide (abdômen, dF na cintura cresce com t) no masculino; ginoide
 * (quadril/glúteo, dB no quadril) no feminino.
 * ------------------------------------------------------------------------- */

/** Níveis ANATÔMICOS dos keyframes de escultura (y do viewBox, para baixo).
    Ancorar em y físico — não em fração do spline, cujo espaçamento não é
    uniforme: o peito (148) cairia no canal do diafragma. */
const SCULPT_Y = [
  BODY_LEVELS.neckBase, // 72  pescoço
  96, //                        trapézio/alto das costas
  BODY_LEVELS.chest, // 148    peito/busto
  170, //                       diafragma
  BODY_LEVELS.waist, // 192    cintura/umbigo
  218, //                       abdômen baixo
  BODY_LEVELS.hip, // 242      quadril/glúteo (o PICO do volume traseiro)
  BODY_LEVELS.hip + 16, // 258 fecho do tronco (afunila para as pernas)
] as const;

/** Canais de escultura por sexo — funções de t (desvio de IMC). */
function sculptChannels(sex: BodySex, t: number): { dF: number[]; dB: number[]; zC: number[]; p: number[] } {
  //            pescoço trapézio peito  diafrag cintura abdômen quadril fecho
  const base = {
    neutro: {
      dF: [0.95, 0.82, 0.96, 0.88 + 0.18 * t, 0.88 + 0.35 * t, 0.96 + 0.4 * t, 0.92, 0.82],
      dB: [0.95, 0.88, 0.8, 0.76, 0.74, 0.82, 1.02 + 0.1 * t, 0.88],
      p: [1, 0.9, 0.85, 0.9, 1, 1, 1, 1],
    },
    masculino: {
      dF: [0.95, 0.8, 1.02, 0.9 + 0.25 * t, 0.92 + 0.55 * t, 1.0 + 0.6 * t, 0.9, 0.8],
      dB: [0.95, 0.9, 0.82, 0.78, 0.76, 0.82, 0.98 + 0.08 * t, 0.86],
      p: [1, 0.85, 0.68, 0.85, 0.95, 0.95, 1, 1],
    },
    feminino: {
      dF: [0.95, 0.8, 1.16, 0.84 + 0.12 * t, 0.82 + 0.25 * t, 0.92 + 0.3 * t, 0.95, 0.84],
      dB: [0.95, 0.86, 0.78, 0.74, 0.72, 0.8, 1.14 + 0.16 * t, 0.92],
      p: [1, 0.9, 1.3, 1, 1, 1, 1.05, 1],
    },
  }[sex];
  // curvatura de coluna (px absolutos): trapézio recua, lombar avança, glúteo recua
  const zC = [0, -1.5, 0, 1, 2.5, 1.5, -2, -2.5];
  return { ...base, zC };
}

/** Interpola um canal nos níveis SCULPT_Y com suavização (smoothstep). */
function channelAt(values: readonly number[], ySvg: number): number {
  const clamped = Math.min(SCULPT_Y[SCULPT_Y.length - 1]!, Math.max(SCULPT_Y[0]!, ySvg));
  let seg = 0;
  while (seg < SCULPT_Y.length - 2 && clamped > SCULPT_Y[seg + 1]!) seg += 1;
  const y0 = SCULPT_Y[seg]!;
  const y1 = SCULPT_Y[seg + 1]!;
  const u = (clamped - y0) / (y1 - y0);
  const smooth = u * u * (3 - 2 * u);
  return values[seg]! + (values[seg + 1]! - values[seg]!) * smooth;
}

export interface TorsoMeshData {
  /** xyz intercalado (y para cima, unidades do viewBox). */
  positions: number[];
  /** Triângulos (índices em positions/3), malha fechada com tampas. */
  indices: number[];
}

/**
 * Malha do tronco (anéis × segmentos + 2 tampas) — dados puros, sem three:
 * o componente monta a BufferGeometry e computa as normais.
 */
export function buildTorsoGeometry(
  imc: number,
  sex: BodySex = 'neutro',
  rings = 36,
  segments = 48,
): TorsoMeshData {
  const profile = torsoProfile(imc, rings, sex);
  const t = bodyDims(imc, sex).t;
  const ch = sculptChannels(sex, t);
  const positions: number[] = [];
  const indices: number[] = [];

  const backShape = 0.85; // costas levemente achatadas, iguais nos 3 corpos

  for (let i = 0; i < rings; i += 1) {
    const { radius: R, y } = profile[i]!;
    const ySvg = BODY_VIEW_H - y;
    const dF = channelAt(ch.dF, ySvg);
    const dB = channelAt(ch.dB, ySvg);
    const zC = channelAt(ch.zC, ySvg);
    const p = channelAt(ch.p, ySvg);
    for (let j = 0; j < segments; j += 1) {
      const theta = (j / segments) * Math.PI * 2; // θ=0 é a FRENTE (+z)
      const cosT = Math.cos(theta);
      const x = R * Math.sin(theta);
      const z =
        cosT >= 0
          ? zC + R * dF * Math.pow(cosT, p)
          : zC - R * dB * Math.pow(-cosT, backShape);
      positions.push(x, y, z);
    }
  }

  // quads entre anéis (com wrap no último segmento)
  for (let i = 0; i < rings - 1; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const j2 = (j + 1) % segments;
      const a = i * segments + j;
      const b = i * segments + j2;
      const c = (i + 1) * segments + j;
      const d = (i + 1) * segments + j2;
      indices.push(a, c, b, b, c, d);
    }
  }

  // tampas (fan) — sem elas o interior oco aparece em ângulos rasos
  const topCenter = positions.length / 3;
  positions.push(0, profile[0]!.y, channelAt(ch.zC, BODY_VIEW_H - profile[0]!.y));
  const bottomCenter = positions.length / 3;
  positions.push(0, profile[rings - 1]!.y, channelAt(ch.zC, BODY_VIEW_H - profile[rings - 1]!.y));
  for (let j = 0; j < segments; j += 1) {
    const j2 = (j + 1) % segments;
    indices.push(topCenter, j, j2);
    const base = (rings - 1) * segments;
    indices.push(bottomCenter, base + j2, base + j);
  }

  return { positions, indices };
}
