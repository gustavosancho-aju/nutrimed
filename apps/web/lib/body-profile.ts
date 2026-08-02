/**
 * Parametrização corporal por IMC da SILHUETA 2D (BodyFigure) — o fallback do
 * palco quando não há WebGL. O corpo 3D não usa mais esta matemática: ele é um
 * mesh humano real (MakeHuman CC0) deformado pelos targets do próprio
 * MakeHuman (ver `lib/body-mesh.ts`); a escultura procedural do tronco foi
 * removida com ele.
 *
 * Unidades: as do viewBox histórico da silhueta (200×430, y PARA BAIXO,
 * eixo central em x=100). Apoio VISUAL — não é avaliação clínica.
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
