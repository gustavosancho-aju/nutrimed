import { classifyImc } from '@/lib/dashboard';
import { IMC_TONE_HEX } from '@/lib/imc-colors';
import { bodyDims } from '@/lib/body-profile';

/**
 * Figura corporal paramétrica (modo apresentação). Silhueta humana em SVG cuja
 * morfologia (ombros/tórax/cintura/quadril/membros) varia com o IMC — a cintura
 * e o quadril crescem mais que os ombros, aproximando a mudança real de
 * composição.
 *
 * Tratamento v2 (rodada premium 2026-07-31): a silhueta é uma "estátua" na
 * tinta do tema (escura no claro, marfim no Noir) com rim light dourado —
 * NÃO é mais pintada com a cor da categoria: um corpo inteiro vermelho na
 * frente do paciente lia como acusação, não como informação (mesma régua do
 * E15: nunca linguagem de culpa). A categoria continua informada 3×: aura
 * suave atrás da figura, chip textual e medidor OMS — cor nunca sozinha.
 *
 * `ghostImc` desenha por cima um CONTORNO tracejado (verde meta, mesmo código
 * visual da linha de meta do TrendChart) do tronco na silhueta-alvo — o "para
 * onde vamos" sobreposto ao "onde estamos".
 *
 * Apoio VISUAL de apresentação — não é avaliação clínica (a conduta é do médico).
 * Estático (seguro p/ prefers-reduced-motion); cor sempre acompanhada de rótulo
 * textual no componente pai.
 */

const cx = 100; // eixo central do viewBox

// A matemática das larguras (bodyDims) vive em lib/body-profile — fonte única
// compartilhada com o manequim 3D: o slider morfa as duas representações igual.

/** Contorno do tronco (simétrico, curvas suaves): pescoço → ombro → tórax → cintura → quadril. */
function torsoPath({ shoulder, chest, waist, hip }: ReturnType<typeof bodyDims>): string {
  return [
    `M ${cx - 12},72`,
    `C ${cx - 26},78 ${cx - shoulder},84 ${cx - shoulder},100`,
    `C ${cx - shoulder + 2},120 ${cx - chest},128 ${cx - chest},148`,
    `C ${cx - chest},168 ${cx - waist},176 ${cx - waist},192`,
    `C ${cx - waist},214 ${cx - hip},222 ${cx - hip},242`,
    `L ${cx + hip},242`,
    `C ${cx + hip},222 ${cx + waist},214 ${cx + waist},192`,
    `C ${cx + waist},176 ${cx + chest},168 ${cx + chest},148`,
    `C ${cx + chest},128 ${cx + shoulder - 2},120 ${cx + shoulder},100`,
    `C ${cx + shoulder},84 ${cx + 26},78 ${cx + 12},72`,
    'Z',
  ].join(' ');
}

/** Pontos de referência anatômicos (nível vertical no viewBox + rótulo). */
const LANDMARKS = [
  { label: 'Tórax', y: 148, dim: 'chest' as const },
  { label: 'Cintura', y: 192, dim: 'waist' as const },
  { label: 'Quadril', y: 236, dim: 'hip' as const },
];

export function BodyFigure({
  imc,
  ghostImc,
  showLandmarks = false,
  className = '',
}: {
  imc: number;
  /** IMC da silhueta-alvo (meta) — desenhada como contorno tracejado por cima. */
  ghostImc?: number;
  /** Marca os pontos de referência (tórax/cintura/quadril) com guia + rótulo. */
  showLandmarks?: boolean;
  className?: string;
}) {
  const tone = classifyImc(imc).tone;
  const aura = IMC_TONE_HEX[tone];
  const d = bodyDims(imc);
  const torso = torsoPath(d);

  const armXTop = d.shoulder + d.armW * 0.4;
  const armXBottom = d.shoulder + 14 + 6 * d.t;

  return (
    <svg
      viewBox="0 0 200 430"
      className={className}
      role="img"
      aria-label={`Silhueta corporal ilustrativa para IMC ${imc.toFixed(1)}${
        ghostImc !== undefined ? `; contorno tracejado = silhueta na meta (IMC ${ghostImc.toFixed(1)})` : ''
      }`}
    >
      <defs>
        {/* estátua na tinta do tema: volume por queda vertical de opacidade */}
        <linearGradient id="bf-body" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="hsl(var(--text))" stopOpacity="0.95" />
          <stop offset="100%" stopColor="hsl(var(--text))" stopOpacity="0.72" />
        </linearGradient>
        {/* aura da categoria — luz de museu atrás da estátua, nunca na "pele" */}
        <radialGradient id="bf-aura" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0%" stopColor={aura} stopOpacity="0.2" />
          <stop offset="100%" stopColor={aura} stopOpacity="0" />
        </radialGradient>
        {/* brilho de superfície (volume) */}
        <radialGradient id="bf-sheen" cx="0.35" cy="0.25" r="0.8">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* aura da categoria (informativa; acompanha o chip e o medidor) */}
      <ellipse cx={cx} cy={210} rx={92} ry={175} fill="url(#bf-aura)" />

      {/* sombra de chão */}
      <ellipse cx={cx} cy={414} rx={52 + 14 * d.t} ry={9} fill="#000000" opacity="0.2" />

      {/* rim light dourado: o traço que faz a estátua "pegar luz" no Noir */}
      <g fill="url(#bf-body)" stroke="hsl(var(--accent-gold) / 0.55)" strokeWidth="1.25">
        {/* cabeça + pescoço (não escalam com o IMC) */}
        <circle cx={cx} cy={40} r={24} />
        <rect x={cx - 9} y={60} width={18} height={16} rx={7} />

        {/* braços (úmero + antebraço, pontas arredondadas) */}
        <line x1={cx - armXTop} y1={104} x2={cx - armXBottom} y2={176} stroke="url(#bf-body)" strokeWidth={d.armW * 2} strokeLinecap="round" />
        <line x1={cx - armXBottom} y1={172} x2={cx - armXBottom - 3} y2={244} stroke="url(#bf-body)" strokeWidth={d.armW * 1.6} strokeLinecap="round" />
        <line x1={cx + armXTop} y1={104} x2={cx + armXBottom} y2={176} stroke="url(#bf-body)" strokeWidth={d.armW * 2} strokeLinecap="round" />
        <line x1={cx + armXBottom} y1={172} x2={cx + armXBottom + 3} y2={244} stroke="url(#bf-body)" strokeWidth={d.armW * 1.6} strokeLinecap="round" />

        {/* tronco */}
        <path d={torso} />

        {/* pernas (coxa + panturrilha) */}
        <line x1={cx - d.hip / 2 - 4} y1={240} x2={cx - 19} y2={324} stroke="url(#bf-body)" strokeWidth={d.thighW * 2} strokeLinecap="round" />
        <line x1={cx - 19} y1={318} x2={cx - 17} y2={402} stroke="url(#bf-body)" strokeWidth={d.calfW * 2} strokeLinecap="round" />
        <line x1={cx + d.hip / 2 + 4} y1={240} x2={cx + 19} y2={324} stroke="url(#bf-body)" strokeWidth={d.thighW * 2} strokeLinecap="round" />
        <line x1={cx + 19} y1={318} x2={cx + 17} y2={402} stroke="url(#bf-body)" strokeWidth={d.calfW * 2} strokeLinecap="round" />
      </g>

      {/* brilho superior (volume) */}
      <ellipse cx={cx - 12} cy={130} rx={d.chest} ry={54} fill="url(#bf-sheen)" />

      {/* contorno-alvo (meta): tronco tracejado por CIMA — visível quando a
          silhueta atual é maior ou menor que a meta. Verde da linha de meta
          (vocabulário semântico do TrendChart), com halo suave para leitura
          sobre a estátua escura E a clara. */}
      {ghostImc !== undefined && (
        <>
          {/* halo claro dá leitura sobre a estátua escura; o TRAÇO fica no
              verde profundo (#059669, ≥3:1 sobre marfim) — o claro #10b981
              reprovaria contraste não-textual nos temas claros. */}
          <path
            d={torsoPath(bodyDims(ghostImc))}
            fill="none"
            stroke="#10b981"
            strokeWidth="6"
            strokeLinejoin="round"
            opacity="0.22"
          />
          <path
            d={torsoPath(bodyDims(ghostImc))}
            fill="none"
            stroke="#059669"
            strokeWidth="2.5"
            strokeDasharray="7 5"
            strokeLinejoin="round"
            opacity="0.95"
          />
        </>
      )}

      {/* pontos de referência: guia horizontal no nível anatômico + rótulo à
          direita — tokens do tema (o cinza fixo sumia no Noir). */}
      {showLandmarks &&
        LANDMARKS.map(({ label, y, dim }) => {
          const half = d[dim];
          return (
            <g key={label} stroke="hsl(var(--text-muted))" opacity="0.8">
              <line
                x1={cx - half - 10}
                y1={y}
                x2={cx + half + 10}
                y2={y}
                strokeWidth="1.25"
                strokeDasharray="3 3"
              />
              <circle cx={cx - half - 10} cy={y} r="2.5" fill="hsl(var(--text-muted))" strokeWidth="0" />
              <circle cx={cx + half + 10} cy={y} r="2.5" fill="hsl(var(--text-muted))" strokeWidth="0" />
              <text
                x={cx + half + 16}
                y={y + 3.5}
                stroke="none"
                fill="hsl(var(--text-muted))"
                fontSize="11"
                fontWeight="600"
              >
                {label}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
