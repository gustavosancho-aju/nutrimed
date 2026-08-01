'use client';

import { useEffect, useRef, useState } from 'react';

/** Mesma regra de formatação dos cartões: inteiro seco, senão 1 casa. */
function fmt(n: number, decimals: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(decimals);
}

/**
 * Número com contagem de entrada (teatro do Modo Apresentação). O servidor
 * renderiza o VALOR FINAL — sem JS ou com `prefers-reduced-motion` o número
 * está certo desde o primeiro paint; a animação (700ms, ease-out) só roda no
 * cliente, uma vez, ao montar. Nunca em telas de trabalho do médico.
 */
export function CountUp({
  value,
  decimals = 1,
  durationMs = 700,
  className,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3; // ease-out cúbico
      setShown(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [value, durationMs]);

  // Durante a contagem, arredonda no mesmo nº de casas do valor final — senão
  // "28" viraria "27.6" no meio da animação e o layout pularia.
  const text = Number.isInteger(value)
    ? String(Math.round(shown))
    : fmt(Number(shown.toFixed(decimals)), decimals);

  return <span className={className}>{text}</span>;
}
