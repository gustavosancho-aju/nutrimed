/**
 * Vocabulário clínico para boost do STT (Story 2.6 / risco T4).
 *
 * Fonte única e versionada dos termos que o STT deve reforçar
 * (`SttOpenOptions.vocabularyBoost` → `keywords=` no Deepgram), derivada dos
 * escopos e gatilhos das personas (`docs/personas-knowledge-base-seed.md`,
 * Article IV) e do recordatório alimentar do relatório nutricional (E13):
 * - Paulo (cardio): segurança CV de fármacos, hipertensão, dislipidemia;
 * - Yara (endo): eixo tireoidiano, metabólico;
 * - Aurélio (nutro): obesidade, composição corporal, recordatório alimentar.
 *
 * CURADORIA DELIBERADA (não é dump): o parâmetro `keywords=` legado do Deepgram
 * degrada com excesso de termos (insere falsos positivos). Mantemos termos de
 * ALTO VALOR que (a) o STT tende a corromper em pt-BR e (b) importam para
 * gatilho do board (E4) OU extração do recordatório (E13). O salto real de
 * acurácia é Nova-3 `keyterm` + POC 2.5 (não alongar esta lista indefinidamente).
 * Termos errados pelo STT propagam para gatilhos e recordatório — cada termo aqui
 * paga o próprio custo.
 */
export const CLINICAL_VOCABULARY: readonly string[] = [
  // ── fármacos / classes (gatilhos de segurança do Paulo) ──
  'GLP-1',
  'semaglutida',
  'liraglutida',
  'tirzepatida',
  'sibutramina',
  'anfepramona',
  'termogênico',
  'metformina',
  'ozempic',
  'mounjaro',
  'orlistate',
  'levotiroxina',
  'espironolactona',
  'topiramato',
  // ── cardio (Paulo) ──
  'hipertensão',
  'dislipidemia',
  'palpitação',
  'taquicardia',
  'pressão arterial',
  'arritmia',
  'colesterol',
  'triglicerídeos',
  'LDL',
  'HDL',
  // lição da consulta cbb25091 (2026-07-04): o STT transcreveu "precordial" como
  // "primordial" e "palpitação" como "próvercoação" — a dor precordial aos
  // esforços passou invisível pelos gatilhos do Paulo (E4).
  'precordial',
  'precordialgia',
  'dor torácica',
  'angina',
  'dispneia',
  'edema',
  // ── endócrino (Yara) ──
  'TSH',
  'T4 livre',
  'hipotireoidismo',
  'hipertireoidismo',
  'tireoide',
  'cortisol',
  'HbA1c',
  'hemoglobina glicada',
  'glicemia',
  'insulina',
  'resistência insulínica',
  'esteatose hepática',
  'síndrome metabólica',
  'vitamina D',
  'ferritina',
  // ── nutro / composição corporal (Aurélio) ──
  'bioimpedância',
  'platô',
  'saciedade',
  'massa magra',
  'massa gorda',
  'IMC',
  'circunferência abdominal',
  'déficit calórico',
  'jejum intermitente',
  'recordatório alimentar',
  // ── alimentos / macros / suplementos (recordatório — E13) ──
  'proteína',
  'carboidrato',
  'creatina',
  'whey protein',
  'ômega-3',
  'quinoa',
  'aveia',
  'tapioca',
  'batata-doce',
];
