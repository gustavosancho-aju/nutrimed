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
    // "primordial" cobre a corrupção recorrente de "precordial" pelo STT
    // (consulta cbb25091, 2026-07-04) — recall > precisão em gatilho crítico.
    pattern:
      /press[ãa]o alta|hipertens[ãa]o|palpita[çc][õo]?[ãa]?[oe]s?|dor (no peito|tor[áa]cica|precordial|primordial)|pr[eé]?[- ]?cordial|precordialgia|aperto no peito|angina|falta de ar|dispneia/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.9,
  },
  {
    // Dor aos esforços: bandeira vermelha CV clássica que não depende de o
    // paciente nomear a região certa (ou de o STT acertar "precordial").
    id: 'paulo-dor-esforco',
    personaId: 'paulo',
    pattern: /dor(es)?\b.{0,60}\b(esfor[çc]o|exerc[íi]cio|atividade f[íi]sica|caminhada|academia)/i,
    typeHint: 'atencao',
    severityHint: 'critical',
    baseWeight: 0.8,
  },
  {
    id: 'paulo-risco-cv',
    personaId: 'paulo',
    pattern: /dislipidemia|colesterol|diabetes|tabagis|sobrepeso|obesidade/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    // calibração 2026-07-20: baseWeight 0.5 era matematicamente MORTO — com a
    // fórmula antiga do scorer, nenhuma frase (curta ou longa) alcançava o
    // limiar 0.6. Ver packages/engines/src/gate.ts (scoreMatch).
    baseWeight: 0.6,
  },
  {
    // histórico familiar CV — anamnese comum em consulta real, não coberta antes.
    id: 'paulo-historico-familiar-cv',
    personaId: 'paulo',
    pattern:
      /hist[óo]ria familiar.{0,40}(infarto|avc|derrame|cardi[ao]|cora[çc][ãa]o)|(pai|m[ãa]e|irm[ãa]o|irm[ãa]|av[ôo]|av[óo]).{0,20}(infarto|avc|derrame)/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.55,
  },
  {
    id: 'paulo-edema-tontura',
    personaId: 'paulo',
    pattern: /incha[çc]o|edema|p[ée]s inchados|pernas inchadas|tontura|tontear/i,
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
    baseWeight: 0.6,
  },
  {
    id: 'yara-sono',
    personaId: 'yara',
    pattern: /ins[ôo]nia|dorme mal|dificuldade (pra|para) dormir|apneia( do sono)?/i,
    typeHint: 'hipotese',
    severityHint: 'normal',
    baseWeight: 0.55,
  },
  {
    id: 'yara-ciclo-hormonal',
    personaId: 'yara',
    pattern: /ciclo (menstrual )?irregular|menstrua[çc][ãa]o irregular|anticoncepcional|reposi[çc][ãa]o hormonal|menopausa/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
];

/**
 * Aurélio (nutro): dieta/hábitos + sinais de deficiência (KB seed) + ampliação
 * (calibração 2026-07-20 — piloto relatou "os médicos não entraram para
 * ajudar"): o catálogo original tinha só 2 regras para o escopo mais amplo do
 * board (condução geral do caso) — anamnese real toca em muito mais temas.
 */
export const AURELIO_TRIGGERS: readonly PersonaTriggerDef[] = [
  {
    id: 'aurelio-dieta-habitos',
    personaId: 'aurelio',
    pattern: /dieta|alimenta[çc][ãa]o|h[áa]bitos?|rotina alimentar|peso/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    // calibração 2026-07-20: 0.4 era matematicamente MORTO (nunca alcançava
    // o limiar antigo, mesmo na frase mais curta possível). Ver gate.ts.
    baseWeight: 0.55,
  },
  {
    id: 'aurelio-deficiencias',
    personaId: 'aurelio',
    pattern: /cansa[çc]o|queda de cabelo|unhas (fracas|quebradi[çc]as)|defici[êe]ncia/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.6,
  },
  {
    id: 'aurelio-atividade-fisica',
    personaId: 'aurelio',
    pattern: /sedentari[oa]|atividade f[íi]sica|exerc[íi]cio|caminhada|academia|treino/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
  {
    id: 'aurelio-intestino',
    personaId: 'aurelio',
    pattern: /intestino (preso|solto)?|constipa[çc][ãa]o|preso do intestino|diarreia/i,
    typeHint: 'sugestao',
    severityHint: 'normal',
    baseWeight: 0.5,
  },
  {
    id: 'aurelio-historico-familiar',
    personaId: 'aurelio',
    pattern: /hist[óo]ria familiar.{0,30}(obesidade|diabetes)|(pai|m[ãa]e|fam[íi]lia).{0,20}(obes[oa]|diab[ée]tic[oa])/i,
    typeHint: 'hipotese',
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
