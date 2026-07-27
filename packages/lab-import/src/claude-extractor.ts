import { stripJsonFences } from '@nutrimed/providers';
import {
  type ILabExtractor,
  type LaudoInput,
  type LaudoKind,
  type ExtractedLaudo,
  type ExtractedPanel,
  KNOWN_FIELDS,
  sanitizeExtraction,
  sanitizePanel,
} from './extractor';

/**
 * Extrator via Claude lendo o PDF NATIVAMENTE (ADR-012, 1ª implementação).
 * Envia o laudo como content block `document` (base64) à Messages API — mesmo
 * padrão `fetch` (sem SDK) de `@nutrimed/llm-anthropic`. Produz apenas um
 * rascunho estruturado; a confirmação do médico é obrigatória (Story 11.10).
 *
 * O canal (API direta vs. Bedrock/Vertex) é reavaliável na comercialização sem
 * mudar o resto — esta classe está atrás de `ILabExtractor` (ADR-012/NFR8).
 */

export interface ClaudeExtractorConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly maxTokens?: number;
  /** Teto de saída do painel completo (E14) — separado do extract legado. */
  readonly panelMaxTokens?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export class LabExtractorError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'api' | 'parse',
  ) {
    super(message);
    this.name = 'LabExtractorError';
  }
}

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * Sinônimos/rótulos comuns em laudos de bioimpedância (InBody, Tanita etc.) que
 * raramente usam o nome literal do campo — sem isso o modelo tende a "não ter
 * certeza" e descartar o valor (efeito observado: laudo com dados, rascunho vazio).
 */
const FIELD_HINTS: Record<string, string> = {
  peso: 'Peso / Weight',
  massaMuscular: 'Massa Muscular Esquelética / Massa Magra / Skeletal Muscle Mass / SMM / FFM',
  massaGordura: 'Massa de Gordura / Body Fat Mass / BFM',
  cintura: 'Circunferência da Cintura / Perímetro Abdominal / Waist Circumference',
  imc: 'IMC / BMI',
  pgc: '% Gordura Corporal / Percentual de Gordura / PBF / Body Fat Percentage',
  aguaCorporal: 'Água Corporal Total / Total Body Water / TBW (em litros)',
  gorduraVisceral: 'Nível/Área de Gordura Visceral / Visceral Fat Level/Area (VFL/VFA)',
  tmb: 'Taxa Metabólica Basal / Basal Metabolic Rate / BMR (kcal)',
};

function systemPrompt(kind: LaudoKind): string {
  const fields = KNOWN_FIELDS[kind]
    .map((f) => (FIELD_HINTS[f] ? `${f} (${FIELD_HINTS[f]})` : f))
    .join(', ');
  const tipo = kind === 'lab' ? 'exames laboratoriais' : 'composição corporal (bioimpedância)';
  return (
    `Você extrai dados de um laudo de ${tipo} para revisão por um médico. ` +
    `Leia o PDF e retorne APENAS um objeto JSON válido (sem cercas de código) no formato ` +
    `{"measuredAt":"YYYY-MM-DD"|null,"values":{${KNOWN_FIELDS[kind].map((f) => `"${f}":number|null`).join(',')}},"notes":"..."}. ` +
    `Use SOMENTE estes campos (com seus sinônimos/rótulos usuais em laudos, entre parênteses): ${fields}. ` +
    `O laudo pode usar qualquer um dos sinônimos/idioma listado para o mesmo campo — reconheça-os. ` +
    `Inclua apenas os que estiver SEGURO de ter lido; use null para os ausentes/ilegíveis. NÃO invente valores. ` +
    `Em "notes", aponte o que ficou ilegível. Números no padrão internacional (ponto decimal).`
  );
}

/**
 * Prompt do PAINEL COMPLETO (E14). Diferente do legado, NÃO há lista de campos:
 * o laudo manda. Três exigências que vieram de laudos reais:
 * - um analito por RESULTADO NUMÉRICO (hemograma e "bilirrubina total e frações"
 *   trazem vários números sob um título só);
 * - a faixa de referência JÁ ESCOLHIDA para o paciente (o laudo lista faixas por
 *   sexo e por idade — mandar o bloco inteiro faria a banda do gráfico sair errada);
 * - a "Evolução do paciente" que o próprio laudo imprime, que vira histórico.
 */
const PANEL_SYSTEM_PROMPT =
  'Você extrai TODOS os resultados de um laudo laboratorial para revisão por um médico. ' +
  'Retorne APENAS um objeto JSON válido (sem cercas de código) no formato ' +
  '{"measuredAt":"YYYY-MM-DD"|null,"analytes":[{"rawName":"...","value":number,"unit":"..."|null,' +
  '"referenceText":"..."|null,"history":[{"measuredAt":"YYYY-MM-DD","value":number}]}],"notes":"..."}. ' +
  'REGRAS: ' +
  '(1) Inclua TODOS os exames com resultado numérico, inclusive os do hemograma e as frações ' +
  '(ex.: bilirrubina total, direta e indireta são TRÊS entradas separadas). Um resultado numérico = uma entrada. ' +
  '(2) "rawName" é o nome do exame EXATAMENTE como impresso no laudo. ' +
  '(3) "referenceText" é a faixa de referência aplicável A ESTE paciente: o laudo lista faixas por sexo e ' +
  'por idade — escolha a linha correta usando o sexo e a idade do paciente no cabeçalho e copie SOMENTE ela ' +
  '(ex.: "de 3,5 a 8,5 mg/dL"). Nunca copie o bloco inteiro de faixas. ' +
  '(4) Se o laudo trouxer "Evolução do paciente" (resultados anteriores com data), inclua-os em "history"; ' +
  'senão omita. Converta datas dd/mm/aaaa para YYYY-MM-DD. ' +
  '(5) "measuredAt" é a data da COLETA. ' +
  '(6) Resultados qualitativos (positivo/negativo, "normocitose") NÃO entram — só números. ' +
  '(7) NÃO invente valores nem faixas; omita o que estiver ilegível e registre em "notes". ' +
  'Números no padrão internacional (ponto decimal).';

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export class ClaudeLabExtractor implements ILabExtractor {
  constructor(private readonly config: ClaudeExtractorConfig) {
    if (!config.apiKey) {
      throw new LabExtractorError('apiKey vazia — credencial da Anthropic é obrigatória.', 'config');
    }
  }

  /** Envia o PDF + prompt e devolve o JSON já parseado (ainda NÃO saneado). */
  private async callModel(
    input: LaudoInput,
    system: string,
    userText: string,
    maxTokens: number,
  ): Promise<unknown> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(this.config.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: input.base64 },
              },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    });

    const data = (await response.json()) as AnthropicResponse;
    if (!response.ok) {
      throw new LabExtractorError(
        `Messages API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }
    this.config.onUsage?.({
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });

    const text = data.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new LabExtractorError('Resposta sem bloco de texto.', 'parse');

    const cleaned = stripJsonFences(text);
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new LabExtractorError(`JSON inválido do modelo: ${text.slice(0, 120)}`, 'parse');
    }
  }

  async extract(input: LaudoInput, kind: LaudoKind): Promise<ExtractedLaudo> {
    const parsed = await this.callModel(
      input,
      systemPrompt(kind),
      'Extraia os campos do laudo conforme o formato JSON pedido.',
      this.config.maxTokens ?? 600,
    );
    // A sanitização é a fronteira de confiança — só campos conhecidos e numéricos.
    return sanitizeExtraction(parsed, kind);
  }

  /**
   * Painel completo (E14). Teto de saída bem maior que o do extract legado: um
   * laudo real deste tamanho passa de 40 analitos, e um `max_tokens` curto
   * truncaria o JSON no meio (que viraria erro de parse, não painel incompleto).
   */
  async extractPanel(input: LaudoInput): Promise<ExtractedPanel> {
    const parsed = await this.callModel(
      input,
      PANEL_SYSTEM_PROMPT,
      'Extraia TODOS os resultados numéricos do laudo conforme o formato JSON pedido.',
      this.config.panelMaxTokens ?? 16000,
    );
    return sanitizePanel(parsed);
  }

  /** Versão do modelo, para a proveniência da auditoria (NFR10) na confirmação. */
  get modelVersion(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }
}
