import { classifyImc, type ImcTone } from '@/lib/dashboard';

/**
 * Figura corporal paramétrica (modo apresentação). Silhueta humana em SVG cuja
 * morfologia (ombros/tórax/cintura/quadril/membros) varia com o IMC — a cintura
 * e o quadril crescem mais que os ombros, aproximando a mudança real de
 * composição. Gradientes + brilho + sombra dão volume (pseudo-3D) sem lib 3D.
 *
 * Apoio VISUAL de apresentação — não é avaliação clínica (a conduta é do médico).
 * Estático (seguro p/ prefers-reduced-motion); cor sempre acompanhada de rótulo
 * textual no componente pai.
 */

const TONE_GRADIENT: Record<ImcTone, { from: string; to: string }> = {
  low: { from: '#38bdf8', to: '#0369a1' },
  ok: { from: '#34d399', to: '#047857' },
  warn: { from: '#fbbf24', to: '#b45309' },
  high: { from: '#fb923c', to: '#c2410c' },
  severe: { from: '#f87171', to: '#b91c1c' },
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function BodyFigure({ imc, className = '' }: { imc: number; className?: string }) {
  const tone = classifyImc(imc).tone;
  const { from, to } = TONE_GRADIENT[tone];

  // Desvio normalizado vs. o centro da faixa saudável (IMC 22):
  // t=0 → silhueta base · t=1 → IMC 40 · negativo → abaixo do peso.
  const t = Math.min(1.2, Math.max(-0.35, (imc - 22) / 18));

  // Meias-larguras (px do viewBox) — cintura/quadril crescem mais que ombros.
  const shoulder = r1(34 * (1 + 0.15 * t));
  const chest = r1(30 * (1 + 0.35 * t));
  const waist = r1(24 * (1 + 0.85 * t));
  const hip = r1(30 * (1 + 0.6 * t));
  const armW = r1(9 * (1 + 0.45 * t));
  const thighW = r1(13 * (1 + 0.55 * t));
  const calfW = r1(8.5 * (1 + 0.35 * t));

  const cx = 100; // eixo central
  // Contorno do tronco (simétrico, curvas suaves): pescoço → ombro → tórax →
  // cintura → quadril → base (linha do quadril fecha o tronco).
  const torso = [
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

  const armXTop = shoulder + armW * 0.4;
  const armXBottom = shoulder + 14 + 6 * t;

  return (
    <svg
      viewBox="0 0 200 430"
      className={className}
      role="img"
      aria-label={`Silhueta corporal ilustrativa para IMC ${imc.toFixed(1)}`}
    >
      <defs>
        <linearGradient id="bf-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <radialGradient id="bf-sheen" cx="0.35" cy="0.25" r="0.8">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* sombra de chão */}
      <ellipse cx={cx} cy={414} rx={52 + 14 * t} ry={9} fill="#1c1917" opacity="0.14" />

      <g fill="url(#bf-body)" stroke={to} strokeOpacity="0.25" strokeWidth="1">
        {/* cabeça + pescoço (não escalam com o IMC) */}
        <circle cx={cx} cy={40} r={24} />
        <rect x={cx - 9} y={60} width={18} height={16} rx={7} />

        {/* braços (úmero + antebraço, pontas arredondadas) */}
        <line x1={cx - armXTop} y1={104} x2={cx - armXBottom} y2={176} stroke="url(#bf-body)" strokeWidth={armW * 2} strokeLinecap="round" />
        <line x1={cx - armXBottom} y1={172} x2={cx - armXBottom - 3} y2={244} stroke="url(#bf-body)" strokeWidth={armW * 1.6} strokeLinecap="round" />
        <line x1={cx + armXTop} y1={104} x2={cx + armXBottom} y2={176} stroke="url(#bf-body)" strokeWidth={armW * 2} strokeLinecap="round" />
        <line x1={cx + armXBottom} y1={172} x2={cx + armXBottom + 3} y2={244} stroke="url(#bf-body)" strokeWidth={armW * 1.6} strokeLinecap="round" />

        {/* tronco */}
        <path d={torso} />

        {/* pernas (coxa + panturrilha) */}
        <line x1={cx - hip / 2 - 4} y1={240} x2={cx - 19} y2={324} stroke="url(#bf-body)" strokeWidth={thighW * 2} strokeLinecap="round" />
        <line x1={cx - 19} y1={318} x2={cx - 17} y2={402} stroke="url(#bf-body)" strokeWidth={calfW * 2} strokeLinecap="round" />
        <line x1={cx + hip / 2 + 4} y1={240} x2={cx + 19} y2={324} stroke="url(#bf-body)" strokeWidth={thighW * 2} strokeLinecap="round" />
        <line x1={cx + 19} y1={318} x2={cx + 17} y2={402} stroke="url(#bf-body)" strokeWidth={calfW * 2} strokeLinecap="round" />
      </g>

      {/* brilho superior (volume) */}
      <ellipse cx={cx - 12} cy={130} rx={chest} ry={54} fill="url(#bf-sheen)" />
    </svg>
  );
}
