/**
 * Vocabulário clínico para boost do STT (Story 2.6 / risco T4).
 *
 * Fonte única e versionada dos termos que o STT deve reforçar
 * (`SttOpenOptions.vocabularyBoost`), derivada dos escopos e gatilhos das
 * personas em `docs/personas-knowledge-base-seed.md` (Article IV):
 * - Paulo (cardio): segurança CV de fármacos, hipertensão, dislipidemia;
 * - Yara (endo): eixo tireoidiano, metabólico;
 * - Aurélio (nutro): manejo de obesidade, composição corporal.
 *
 * A POC 2.5 mede o efeito (com vs. sem). Termos errados pelo STT propagam
 * para os gatilhos do board (E4) — manter a lista curta e de alto valor.
 */
export const CLINICAL_VOCABULARY: readonly string[] = [
  // fármacos / classes (gatilhos de segurança do Paulo)
  'GLP-1',
  'semaglutida',
  'liraglutida',
  'tirzepatida',
  'sibutramina',
  'anfepramona',
  'termogênico',
  'metformina',
  // cardio
  'hipertensão',
  'dislipidemia',
  'palpitação',
  'taquicardia',
  'pressão arterial',
  // endócrino (Yara)
  'TSH',
  'T4 livre',
  'hipotireoidismo',
  'cortisol',
  'HbA1c',
  'glicemia',
  'insulina',
  'resistência insulínica',
  // nutro / composição corporal (Aurélio)
  'bioimpedância',
  'platô',
  'saciedade',
  'massa magra',
  'IMC',
];
