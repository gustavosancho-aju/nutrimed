import type { GoalHitStatus } from '@/lib/dashboard';

/**
 * Indicador "bateu/não bateu a meta" do relatório diário (pedido do médico,
 * 2026-07-20) — apoio visual (tolerância simétrica), nunca julgamento clínico
 * de direção. Sempre com texto/rótulo, nunca só cor (mesmo princípio do resto
 * do dashboard — NFR10).
 */
const CONFIG: Record<GoalHitStatus, { symbol: string; label: string; className: string }> = {
  bateu: { symbol: '✓', label: 'Bateu a meta', className: 'text-emerald-600' },
  'nao-bateu': { symbol: '✗', label: 'Não bateu a meta', className: 'text-amber-600' },
  'sem-meta': { symbol: '—', label: 'Sem meta definida', className: 'text-ink-muted' },
  'sem-registro': { symbol: '—', label: 'Sem registro nesse dia', className: 'text-ink-muted' },
};

export function GoalHitBadge({ status }: { status: GoalHitStatus }) {
  const c = CONFIG[status];
  return (
    <span className={`font-semibold ${c.className}`} title={c.label} aria-label={c.label}>
      {c.symbol}
    </span>
  );
}
