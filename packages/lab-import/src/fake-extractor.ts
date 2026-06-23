import {
  type ILabExtractor,
  type LaudoInput,
  type LaudoKind,
  type ExtractedLaudo,
  sanitizeExtraction,
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
}
