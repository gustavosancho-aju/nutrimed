import {
  type ILabExtractor,
  type LaudoInput,
  type LaudoKind,
  type ExtractedLaudo,
  type ExtractedPanel,
  sanitizeExtraction,
  sanitizePanel,
} from './extractor';

/**
 * Extrator determinístico (sem rede) — para testes e para a degradação graciosa
 * (NFR13): permite exercitar o fluxo de importação/confirmação localmente sem
 * credencial nem custo de API. Os valores são EXEMPLOS fixos — a `notes` deixa
 * isso explícito, e a confirmação do médico (Story 11.10) é obrigatória de todo
 * modo (ADR-012).
 */
const SAMPLE: Record<LaudoKind, Record<string, number>> = {
  body: { peso: 84.2, massaMuscular: 35.5, massaGordura: 26.1, cintura: 92, imc: 27.4, pgc: 31 },
  lab: { ldl: 138, hba1c: 5.9, insulina: 14 },
};

export class FakeLabExtractor implements ILabExtractor {
  readonly modelVersion = 'fake-extractor';

  async extract(_input: LaudoInput, kind: LaudoKind): Promise<ExtractedLaudo> {
    return sanitizeExtraction(
      { values: SAMPLE[kind], notes: 'Valores de exemplo (extrator fake) — revise e corrija.' },
      kind,
    );
  }

  /**
   * Painel de exemplo (E14) com os três formatos que a UI precisa exercitar:
   * exame do catálogo com faixa de intervalo, exame com faixa só de teto, e
   * exame com histórico impresso no laudo (que vira linha de tendência).
   */
  async extractPanel(_input: LaudoInput): Promise<ExtractedPanel> {
    return sanitizePanel({
      measuredAt: '2026-05-19',
      analytes: [
        { rawName: 'COLESTEROL LDL', value: 108.5, unit: 'mg/dL', referenceText: 'Inferior a 130 mg/dL', history: [{ measuredAt: '2025-10-22', value: 143.1 }, { measuredAt: '2025-03-25', value: 83.4 }] },
        { rawName: 'COLESTEROL HDL', value: 37, unit: 'mg/dL', referenceText: 'Superior a 40 mg/dL' },
        { rawName: 'TRIGLICERIDES', value: 183, unit: 'mg/dL', referenceText: 'Inferior a 150 mg/dL', history: [{ measuredAt: '2025-10-22', value: 293 }] },
        { rawName: 'HEMOGLOBINA GLICADA (HBA1C)', value: 4.9, unit: '%', referenceText: 'Menor que 5,7%' },
        { rawName: 'TSH ULTRA SENSÍVEL', value: 1.58, unit: 'mUI/mL', referenceText: 'De 0,40 a 4,05 mUI/mL' },
        { rawName: 'MARCADOR EXEMPLO SEM CATÁLOGO', value: 12.3, unit: 'UI/L' },
      ],
      notes: 'Painel de exemplo (extrator fake) — revise e corrija.',
    });
  }
}
