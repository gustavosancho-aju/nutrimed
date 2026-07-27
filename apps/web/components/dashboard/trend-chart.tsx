import { compareTrendPoints, type TrendPoint, type TargetBand } from '@/lib/dashboard';

/**
 * Gráfico de evolução em SVG puro (E11/11.6) — sem dependência de chart lib.
 * Estático (seguro p/ prefers-reduced-motion). A LINHA da série usa `currentColor`
 * (cor via className, ex.: text-brand). Opcionalmente desenha uma FAIXA IDEAL
 * (banda verde saudável) e uma META (linha pontilhada) — apoio visual desde a
 * 1ª medição (um ponto), a linha de evolução surge a partir do 2º ponto.
 *
 * viewBox normalizado + preserveAspectRatio="none" p/ preencher a largura, com
 * vector-effect="non-scaling-stroke" p/ o traço não distorcer. Sem <text> aqui
 * (o "none" distorceria a fonte) — os rótulos ficam no card (HTML).
 */
const W = 300;
const H = 72;
const PAD = 8;

/**
 * Nº máximo de rótulos simultâneos. Acima disso os rótulos são RAREADOS
 * (1 a cada k medições, sempre incluindo a última) — nunca reduzidos só aos
 * extremos, que esconderiam o meio da evolução. Calibrado p/ o card mais
 * estreito da dashboard: ~8 slots de ~55px comportam a data curta.
 */
const MAX_LABELS = 8;

/** Datas em UTC (determinístico servidor/cliente — evita mismatch de hidratação). */
const DATE_FMT_FULL = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});
/** Série inteira no mesmo ano ⇒ o ano vira ruído repetido; fica só dd/mm. */
const DATE_FMT_SHORT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
});

/** Valor sem casas quando inteiro, senão 1 casa (mesma regra do MetricCard). */
function fmtValue(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Deslocamento horizontal do rótulo: centralizado no ponto, mas puxado p/
 * dentro nas extremidades — senão o primeiro/último vazariam do card.
 */
function anchorShift(i: number, total: number): string {
  if (i === 0) return '-15%';
  if (i === total - 1) return '-85%';
  return '-50%';
}

export function TrendChart({
  points,
  className = 'text-brand',
  unit,
  band,
  target,
  heightClass = 'h-16',
  pointLabels = 'auto',
}: {
  points: readonly TrendPoint[];
  className?: string;
  unit?: string;
  /** Faixa ideal (ex.: peso saudável) — banda verde sombreada. */
  band?: TargetBand;
  /** Meta/alvo — linha pontilhada verde. */
  target?: number;
  /** Altura do SVG (Tailwind), ex.: 'h-24' no modo apresentação. */
  heightClass?: string;
  /**
   * Rótulos (valor + data) sobre cada ponto. 'auto' mostra todos até
   * {@link MAX_LABELS} pontos e, acima disso, só o primeiro e o último
   * (senão os rótulos se sobrepõem e viram ruído). 'none' desliga.
   */
  pointLabels?: 'auto' | 'none';
}) {
  if (points.length === 0) {
    return <p className="text-sm text-ink-muted">Sem medições para exibir.</p>;
  }

  const sorted = [...points].sort(compareTrendPoints);
  const values = sorted.map((p) => p.value);
  // O domínio do eixo Y inclui a banda e a meta, para que fiquem sempre visíveis.
  const domain = [...values];
  if (band) domain.push(band.min, band.max);
  if (target !== undefined) domain.push(target);
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const span = max - min || 1; // série/domínio constante ⇒ no meio

  const x = (i: number) =>
    sorted.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (sorted.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

  const pts = sorted.map((p, i) => `${x(i)},${y(p.value)}`);
  const last = sorted[sorted.length - 1]!;

  const ariaExtra = [
    band ? `faixa ideal ${band.min}–${band.max}${unit ?? ''}` : '',
    target !== undefined ? `meta ${target}${unit ?? ''}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  // Quais pontos ganham rótulo. Cabendo, TODOS; senão 1 a cada k, de trás p/
  // frente (a última medição é a que mais importa e nunca pode faltar).
  const labelled = new Set<number>();
  if (pointLabels === 'auto') {
    const step = Math.ceil(sorted.length / MAX_LABELS);
    for (let i = sorted.length - 1; i >= 0; i -= step) labelled.add(i);
  }

  const labelledIdx = [...labelled].sort((a, b) => a - b);
  /** A partir de 5 rótulos os valores passam a alternar em duas fileiras. */
  const staggered = labelled.size > 4;

  // Datas: sem o ano quando a série inteira é do mesmo ano (ruído repetido).
  const sameYear = sorted.every(
    (p) => p.measuredAt.getUTCFullYear() === last.measuredAt.getUTCFullYear(),
  );
  const dateFmt = sameYear ? DATE_FMT_SHORT : DATE_FMT_FULL;

  return (
    // O padding do topo reserva espaço p/ os valores, que ficam FORA da área do
    // gráfico; o wrapper relative é o sistema de coordenadas deles.
    <figure className={`${className} ${labelled.size > 0 ? (staggered ? 'pt-8' : 'pt-4') : ''}`}>
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`${heightClass} w-full`}
        role="img"
        aria-label={`Evolução: ${values.map((v) => `${v}${unit ?? ''}`).join(', ')}${ariaExtra ? `. ${ariaExtra}` : ''}`}
      >
        {/* faixa ideal (zona saudável) — verde translúcido, atrás de tudo */}
        {band && (
          <rect
            x={PAD}
            y={y(band.max)}
            width={W - 2 * PAD}
            height={Math.max(0, y(band.min) - y(band.max))}
            fill="#10b981"
            fillOpacity="0.16"
          />
        )}
        {/* linha base sutil */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />
        {/* meta (alvo) — pontilhada verde */}
        {target !== undefined && (
          <line
            x1={PAD}
            y1={y(target)}
            x2={W - PAD}
            y2={y(target)}
            stroke="#059669"
            strokeWidth="2.5"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {sorted.length > 1 && (
          <polyline
            points={pts.join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {sorted.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="3.5" fill="currentColor" />
        ))}
        {/* último ponto em destaque (onde o paciente está agora) */}
        <circle cx={x(sorted.length - 1)} cy={y(last.value)} r="5.5" fill="currentColor" />
      </svg>
        {/*
          Valores em HTML (não <text>): o preserveAspectRatio="none" do SVG
          distorceria a fonte. Posicionados em % sobre o mesmo domínio do
          gráfico — acima do ponto, ou abaixo quando o ponto está no topo.
        */}
        {labelled.size > 0 && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {sorted.map((p, i) => {
              if (!labelled.has(i)) return null;
              const topPct = (y(p.value) / H) * 100;
              const below = topPct < 34;
              // Série densa: os rótulos vizinhos encostariam num card estreito
              // ('104.2kg' ao lado de '83.4kg'). Alternando em duas fileiras,
              // cada um ganha o dobro de espaço horizontal.
              const row2 = staggered && i % 2 === 1;
              const shift = `${row2 ? 1 : 0} * 0.95rem`;
              return (
                <span
                  key={i}
                  className={`absolute whitespace-nowrap text-[10px] leading-tight xl:text-xs ${
                    i === sorted.length - 1 ? 'font-semibold text-ink' : 'text-ink-muted'
                  }`}
                  style={{
                    left: `${(x(i) / W) * 100}%`,
                    top: `${topPct}%`,
                    transform: `translate(${anchorShift(i, sorted.length)}, ${
                      below
                        ? `calc(0.5rem + ${shift})`
                        : `calc(-100% - 0.35rem - ${shift})`
                    })`,
                  }}
                >
                  {fmtValue(p.value)}
                  {unit ?? ''}
                </span>
              );
            })}
          </div>
        )}
      </div>
      {/*
        Régua de datas: uma coluna por medição rotulada, alinhada aos pontos.
        Medições do MESMO dia (reavaliação, correção) repetiriam a data lado a
        lado — a repetida fica sem rótulo, o valor acima já as distingue.
      */}
      {labelled.size > 0 && (
        <figcaption className="relative mt-1 h-3.5 xl:h-4">
          {labelledIdx.map((i, n) => {
            const text = dateFmt.format(sorted[i]!.measuredAt);
            // Compara com a data ANTERIOR EXIBIDA (não a do ponto anterior,
            // que pode não estar rotulado quando a série é rareada).
            if (n > 0 && text === dateFmt.format(sorted[labelledIdx[n - 1]!]!.measuredAt)) return null;
            return (
              <span
                key={i}
                className="absolute whitespace-nowrap text-[9px] leading-none text-ink-muted xl:text-[11px]"
                style={{
                  left: `${(x(i) / W) * 100}%`,
                  transform: `translateX(${anchorShift(i, sorted.length)})`,
                }}
              >
                {text}
              </span>
            );
          })}
        </figcaption>
      )}
    </figure>
  );
}
