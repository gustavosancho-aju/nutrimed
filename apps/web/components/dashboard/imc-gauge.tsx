import { IMC_CATEGORIES, classifyImc } from '@/lib/dashboard';
import { IMC_TONE_BG, IMC_TONE_HEX } from '@/lib/imc-colors';
import { CountUp } from '@/components/count-up';

/**
 * Medidor radial de IMC (Modo Apresentação) — o arco é o vocabulário FUI que
 * Oura/WHOOP domesticaram para saúde: faixas da OMS como segmentos de um
 * semicírculo, agulha na posição do paciente e o número-herói no centro.
 * Substitui a régua linear SÓ no palco (a informação é a mesma: categorias +
 * limites numéricos + rótulo textual — cor nunca sozinha, NFR10).
 *
 * SVG com aspecto preservado (texto não distorce). Estático por construção —
 * o único movimento é o CountUp do número, que respeita reduced-motion.
 */

const SCALE_MIN = 15;
const SCALE_MAX = 45;

const CX = 130;
const CY = 128;
const R = 100;

/** Ângulo (graus) de um IMC no semicírculo: 15 → 180° (esquerda) · 45 → 0°. */
function angleOf(imc: number): number {
  const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, imc));
  return 180 * (1 - (clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN));
}

/** Ponto no círculo de raio `r` para um ângulo em graus (0° à direita). */
function polar(r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

/** Path de arco entre dois IMCs (sentido horário, sempre < 180°). */
function arcPath(fromImc: number, toImc: number, r: number): string {
  const a = polar(r, angleOf(fromImc));
  const b = polar(r, angleOf(toImc));
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function ImcGauge({ imc }: { imc: number }) {
  const current = classifyImc(imc);
  const needleDeg = angleOf(imc);
  const needleA = polar(R - 22, needleDeg);
  const needleB = polar(R + 12, needleDeg);

  return (
    // role="group": aria-label em div genérica não vira nome acessível
    // confiável — com o role, leitor de tela anuncia "IMC 41.2 — Obesidade…".
    <div role="group" aria-label={`IMC ${imc.toFixed(1)} — ${current.label}`}>
      <div className="relative mx-auto max-w-[420px]">
        <svg viewBox="0 0 260 150" role="img" aria-hidden className="w-full">
          {/* segmentos das faixas OMS — o do paciente aceso, os demais em espera */}
          {IMC_CATEGORIES.map((c) => {
            const from = Math.max(c.min, SCALE_MIN);
            const to = c.max === null ? SCALE_MAX : Math.min(c.max, SCALE_MAX);
            if (to <= from) return null;
            const active = c.key === current.key;
            return (
              <g key={c.key}>
                {/* halo do segmento ativo: o "glow no dado ativo", nunca no chrome */}
                {active && (
                  <path
                    d={arcPath(from, to, R)}
                    stroke={IMC_TONE_HEX[c.tone]}
                    strokeWidth={22}
                    strokeLinecap="butt"
                    fill="none"
                    opacity={0.22}
                  />
                )}
                <path
                  d={arcPath(from, to, R)}
                  stroke={IMC_TONE_HEX[c.tone]}
                  strokeWidth={13}
                  strokeLinecap="butt"
                  fill="none"
                  opacity={active ? 1 : 0.3}
                />
              </g>
            );
          })}

          {/* limites numéricos por fora do arco */}
          {[18.5, 25, 30, 35, 40].map((v) => {
            const p = polar(R + 22, angleOf(v));
            return (
              <text
                key={v}
                x={p.x}
                y={p.y + 3}
                textAnchor="middle"
                fontSize="10"
                fill="hsl(var(--text-muted))"
              >
                {v}
              </text>
            );
          })}

          {/* agulha do paciente */}
          <line
            x1={needleA.x}
            y1={needleA.y}
            x2={needleB.x}
            y2={needleB.y}
            stroke="hsl(var(--text))"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle
            cx={needleB.x}
            cy={needleB.y}
            r={4}
            fill="hsl(var(--text))"
            stroke="hsl(var(--surface))"
            strokeWidth={1.5}
          />
        </svg>

        {/* número-herói no centro do arco (WHOOP: legível a um braço de distância) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-1 text-center">
          <p className="text-xs uppercase tracking-wide text-ink-muted">IMC atual</p>
          <p className="hero-glow font-display text-6xl font-semibold leading-none text-ink">
            <CountUp value={imc} />
          </p>
        </div>
      </div>

      {/* legenda textual — cor nunca sozinha (mesma da régua linear) */}
      <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {IMC_CATEGORIES.map((c) => {
          const active = c.key === current.key;
          return (
            <li
              key={c.key}
              className={`flex items-center gap-1.5 text-[11px] ${active ? 'font-semibold text-ink' : 'text-ink-muted'}`}
            >
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${IMC_TONE_BG[c.tone]} ${active ? '' : 'opacity-40'}`}
              />
              {c.label}
              {active && <span aria-hidden>←</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
