/**
 * Faixas plausíveis para entrada manual (integridade do dado). Rejeita valores
 * clínicos absurdos (ex.: peso 900 kg = typo) ANTES de persistir — o dado
 * absurdo contaminaria gráficos e relatórios. As faixas são GENEROSAS: cobrem
 * qualquer valor real e só barram o obviamente errado. Apoio à digitação, não
 * julgamento clínico.
 */

export interface Range {
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly unit?: string;
}

export const RANGES: Readonly<Record<string, Range>> = {
  // Composição corporal
  peso: { min: 20, max: 400, label: 'Peso', unit: 'kg' },
  massaMuscular: { min: 5, max: 200, label: 'Massa Muscular', unit: 'kg' },
  massaGordura: { min: 1, max: 300, label: 'Massa de Gordura', unit: 'kg' },
  cintura: { min: 30, max: 300, label: 'Cintura', unit: 'cm' },
  imc: { min: 8, max: 100, label: 'IMC' },
  pgc: { min: 1, max: 80, label: '% Gordura', unit: '%' },
  // Exames laboratoriais fixos
  ldl: { min: 5, max: 1000, label: 'LDL', unit: 'mg/dL' },
  hba1c: { min: 2, max: 25, label: 'HbA1C', unit: '%' },
  insulina: { min: 0.1, max: 1000, label: 'Insulina', unit: 'µU/mL' },
  // Exames personalizados — sem faixa conhecida; só sanidade (positivo, não absurdo)
  custom1: { min: 0, max: 1_000_000, label: 'Exame personalizado' },
  custom2: { min: 0, max: 1_000_000, label: 'Exame personalizado' },
  custom3: { min: 0, max: 1_000_000, label: 'Exame personalizado' },
  // Metas nutricionais
  kcal: { min: 0, max: 20_000, label: 'Calorias', unit: 'kcal' },
  protein: { min: 0, max: 5_000, label: 'Proteína', unit: 'g' },
  carbs: { min: 0, max: 5_000, label: 'Carbo', unit: 'g' },
  fat: { min: 0, max: 5_000, label: 'Gordura', unit: 'g' },
};

/** Número "bonito" para a mensagem (inteiro sem casas, senão 1 casa). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Primeiro campo fora da faixa ⇒ mensagem pt-BR; tudo dentro (ou campo sem
 * faixa conhecida) ⇒ null. Ignora `undefined` (campo não preenchido).
 */
export function checkRanges(values: Record<string, unknown>): string | null {
  for (const [name, v] of Object.entries(values)) {
    if (typeof v !== 'number') continue;
    const r = RANGES[name];
    if (!r) continue;
    if (!Number.isFinite(v) || v < r.min || v > r.max) {
      const u = r.unit ? ` ${r.unit}` : '';
      return `${r.label} ${fmt(v)}${u} está fora da faixa plausível (${fmt(r.min)}–${fmt(r.max)}${u}). Confira o valor — nada foi salvo.`;
    }
  }
  return null;
}
