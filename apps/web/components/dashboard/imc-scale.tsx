import { IMC_CATEGORIES, classifyImc, type ImcTone } from '@/lib/dashboard';

/**
 * Régua de classificação de IMC (modo apresentação): barra segmentada pelas
 * faixas da OMS com o marcador do paciente. Cor sempre acompanhada de rótulo
 * textual (acessibilidade/NFR10). Apoio visual — não diagnóstico.
 */

const SCALE_MIN = 15;
const SCALE_MAX = 45;

const TONE_BG: Record<ImcTone, string> = {
  low: 'bg-sky-400',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-400',
  high: 'bg-orange-500',
  severe: 'bg-red-500',
};

/** Posição percentual de um IMC na régua (clampada). */
function pct(imc: number): number {
  const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, imc));
  return ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

export function ImcScale({ imc }: { imc: number }) {
  const current = classifyImc(imc);

  return (
    <div aria-label={`IMC ${imc.toFixed(1)} — ${current.label}`}>
      {/* barra segmentada */}
      <div className="relative">
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {IMC_CATEGORIES.map((c) => {
            const from = Math.max(c.min, SCALE_MIN);
            const to = c.max === null ? SCALE_MAX : Math.min(c.max, SCALE_MAX);
            const width = pct(to) - pct(from);
            if (width <= 0) return null;
            const active = c.key === current.key;
            return (
              <div
                key={c.key}
                className={`${TONE_BG[c.tone]} ${active ? 'opacity-100' : 'opacity-35'} h-full transition-opacity`}
                style={{ width: `${width}%` }}
              />
            );
          })}
        </div>
        {/* marcador do paciente */}
        <div
          className="absolute -top-1.5 h-6 w-[3px] -translate-x-1/2 rounded-full bg-ink shadow"
          style={{ left: `${pct(imc)}%` }}
          aria-hidden
        />
      </div>

      {/* limites numéricos */}
      <div className="relative mt-1 h-4 text-[10px] text-ink-muted" aria-hidden>
        {[18.5, 25, 30, 35, 40].map((v) => (
          <span key={v} className="absolute -translate-x-1/2" style={{ left: `${pct(v)}%` }}>
            {v}
          </span>
        ))}
      </div>

      {/* legenda textual (não depende só de cor) */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {IMC_CATEGORIES.map((c) => {
          const active = c.key === current.key;
          return (
            <li
              key={c.key}
              className={`flex items-center gap-1.5 text-[11px] ${active ? 'font-semibold text-ink' : 'text-ink-muted'}`}
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${TONE_BG[c.tone]} ${active ? '' : 'opacity-40'}`} />
              {c.label}
              {active && <span aria-hidden>←</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
