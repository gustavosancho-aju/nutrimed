import type { ContributionType, ContributionSeverity, PersonaId } from '@nutrimed/providers';

/**
 * Trigger Detector por persona (Story 4.1 — FR3/FR4/FR5, ADR-008).
 *
 * Regra BARATA sobre segmentos finais da transcrição — roda ANTES de qualquer
 * LLM (controle de custo T2). Catálogos derivados dos gatilhos proativos de
 * `personas-knowledge-base-seed.md` (Article IV). Recall priorizado nos
 * gatilhos críticos do Paulo (falso negativo crítico tem custo assimétrico).
 */

export interface PersonaTriggerDef {
  readonly id: string;
  readonly personaId: PersonaId;
  readonly pattern: RegExp;
  /** Dica de tipo de contribuição (⚠️ atencao / 💡 sugestao / 🔍 hipotese). */
  readonly typeHint: ContributionType;
  readonly severityHint: ContributionSeverity;
  /** Peso-base de relevância do gatilho (insumo do Scorer 4.2). */
  readonly baseWeight: number;
}

export interface TriggerMatch {
  readonly trigger: PersonaTriggerDef;
  readonly matchedTerm: string;
  readonly segmentText: string;
  readonly at: number;
}

/** FR4 — Dr. Paulo (cardio): segurança CV de fármacos + sintomas CV. */
export const PAULO_TRIGGERS: readonly PersonaTriggerDef[] = [
  {
    id: 'paulo-cv-farmacos',
    personaId: 'paulo',
    pattern: /GLP-?1|semaglutida|liraglutida|tirzepatida|anfepramona|sibutramina|termog[êe]nicos?/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.9,
  },
  {
    id: 'paulo-cv-sintomas',
    personaId: 'paulo',
    pattern: /press[ãa]o alta|hipertens[ãa]o|palpita[çc][õo]?[ãa]?[oe]s?|dor (no peito|tor[áa]cica)|falta de ar|dispneia/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.9,
  },
  {
    id: 'paulo-risco-cv',
    personaId: 'paulo',
    pattern: /dislipidemia|colesterol|diabetes|tabagis|sobrepeso|obesidade/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
];

/** FR5 — Dra. Yara (endo): hipótese tireoidiana + platô metabólico. */
export const YARA_TRIGGERS: readonly PersonaTriggerDef[] = [
  {
    id: 'yara-tireoide',
    personaId: 'yara',
    pattern: /cansa[çc]o|fadiga|ganho de peso|sente (muito )?frio|intoler[âa]ncia ao frio|queda de cabelo/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
  {
    id: 'yara-plato-metabolico',
    personaId: 'yara',
    pattern: /plat[ôo]|estagnou|n[ãa]o (perde|emagrece) mais/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.65,
  },
  {
    id: 'yara-metabolico',
    personaId: 'yara',
    pattern: /resist[êe]ncia insul[íi]nica|pr[ée]-?diabetes|diabetes|GLP-?1|semaglutida/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.55,
  },
];

/** Aurélio (nutro): dieta/hábitos + sinais de deficiência (KB seed). */
export const AURELIO_TRIGGERS: readonly PersonaTriggerDef[] = [
  {
    id: 'aurelio-dieta-habitos',
    personaId: 'aurelio',
    pattern: /dieta|alimenta[çc][ãa]o|h[áa]bitos?|rotina alimentar|peso/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.4,
  },
  {
    id: 'aurelio-deficiencias',
    personaId: 'aurelio',
    pattern: /cansa[çc]o|queda de cabelo|unhas (fracas|quebradi[çc]as)|defici[êe]ncia/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
];

export const ALL_TRIGGERS: readonly PersonaTriggerDef[] = [
  ...PAULO_TRIGGERS,
  ...YARA_TRIGGERS,
  ...AURELIO_TRIGGERS,
];

export class TriggerDetector {
  constructor(private readonly triggers: readonly PersonaTriggerDef[] = ALL_TRIGGERS) {}

  /** Detecta gatilhos num segmento FINAL. Zero LLM (T2). */
  detect(segmentText: string, at: number): TriggerMatch[] {
    const matches: TriggerMatch[] = [];
    for (const trigger of this.triggers) {
      const m = trigger.pattern.exec(segmentText);
      if (m) matches.push({ trigger, matchedTerm: m[0], segmentText, at });
    }
    return matches;
  }
}
