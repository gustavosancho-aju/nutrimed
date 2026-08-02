import type { ImcTone } from '@/lib/dashboard';

/**
 * Paleta ÚNICA das categorias de IMC (OMS) — fonte de verdade para o medidor
 * radial (arco), a aura da estátua e o ponto do chip. Antes eram 3 cópias dos
 * mesmos 5 tons em 3 arquivos: mudar um e esquecer os outros faria a MESMA
 * tela de Apresentação divergir de si própria, sem erro de build.
 */
export const IMC_TONE_HEX: Record<ImcTone, string> = {
  low: '#38bdf8',
  ok: '#10b981',
  warn: '#fbbf24',
  high: '#f97316',
  severe: '#ef4444',
};

/** Mesmos tons como classes Tailwind (pontos de legenda/chip). */
export const IMC_TONE_BG: Record<ImcTone, string> = {
  low: 'bg-sky-400',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-400',
  high: 'bg-orange-500',
  severe: 'bg-red-500',
};
