import type { TrendPoint } from '@/lib/dashboard';

/**
 * Gráfico de evolução em SVG puro (E11/11.6) — sem dependência de chart lib.
 * Estático (seguro p/ prefers-reduced-motion). Usa `currentColor` para a linha,
 * então a cor vem do design system via className (ex.: text-brand).
 *
 * Técnica: viewBox normalizado + preserveAspectRatio="none" para preencher a
 * largura, com vector-effect="non-scaling-stroke" para o traço não distorcer.
 */
const W = 300;
const H = 72;
const PAD = 8;

export function TrendChart({
  points,
  className = 'text-brand',
  unit,
}: {
  points: readonly TrendPoint[];
  className?: string;
  unit?: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-ink-muted">Sem medições para exibir.</p>;
  }

  const sorted = [...points].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  const values = sorted.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // série constante ⇒ linha no meio

  const x = (i: number) =>
    sorted.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (sorted.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

  const pts = sorted.map((p, i) => `${x(i)},${y(p.value)}`);
  const last = sorted[sorted.length - 1]!;

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={`Evolução: ${values.map((v) => `${v}${unit ?? ''}`).join(', ')}`}
      >
        {/* linha base sutil */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />
        {sorted.length > 1 && (
          <polyline
            points={pts.join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {sorted.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill="currentColor" />
        ))}
        {/* último ponto em destaque */}
        <circle cx={x(sorted.length - 1)} cy={y(last.value)} r="4" fill="currentColor" />
      </svg>
    </figure>
  );
}
