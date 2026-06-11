import { DisclaimerNote } from './disclaimer-note';
import type { BoardContributionItem } from '@/lib/board-store';

/**
 * `<ContributionCard>` mínimo (Story 3.3 — frontend-spec §6): persona, tipo,
 * texto e o disclaimer FR19 (Atom da 1.7 — REUSE). Os 4 tipos completos,
 * controles e decaimento são E7.
 */

const PERSONA_LABEL: Record<string, string> = {
  aurelio: 'Dr. Aurélio · Nutrologia',
  paulo: 'Dr. Paulo · Cardiologia',
  yara: 'Dra. Yara · Endocrinologia',
};

const TYPE_LABEL: Record<string, string> = {
  atencao: '⚠️ Atenção',
  sugestao: '💡 Sugestão',
  hipotese: '🔍 Hipótese',
  sintese: '📋 Síntese',
};

export function ContributionCard({ item }: { item: BoardContributionItem }) {
  const { contribution } = item;
  const critical = contribution.severity === 'critical';
  return (
    <article
      aria-label={`Contribuição de ${PERSONA_LABEL[contribution.personaId] ?? contribution.personaId}`}
      data-severity={contribution.severity}
      className={`rounded-lg border p-4 ${critical ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}
    >
      <header className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">
          {PERSONA_LABEL[contribution.personaId] ?? contribution.personaId}
        </span>
        <span className="text-xs text-gray-600">{TYPE_LABEL[contribution.type] ?? contribution.type}</span>
      </header>
      <p className="mt-2 text-sm text-gray-800">{contribution.text}</p>
      <footer className="mt-3 border-t border-gray-200/70 pt-2">
        <DisclaimerNote variant="card" />
      </footer>
    </article>
  );
}
