import { stripJsonFences } from '@nutrimed/providers';
import {
  type ILabExtractor,
  type LaudoInput,
  type LaudoKind,
  type ExtractedLaudo,
  KNOWN_FIELDS,
  sanitizeExtraction,
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

function systemPrompt(kind: LaudoKind): string {
  const fields = KNOWN_FIELDS[kind].join(', ');
  const tipo = kind === 'lab' ? 'exames laboratoriais' : 'composição corporal (bioimpedância)';
  return (
    `Você extrai dados de um laudo de ${tipo} para revisão por um médico. ` +
    `Leia o PDF e retorne APENAS um objeto JSON válido (sem cercas de código) no formato ` +
    `{"measuredAt":"YYYY-MM-DD"|null,"values":{${KNOWN_FIELDS[kind].map((f) => `"${f}":number|null`).join(',')}},"notes":"..."}. ` +
    `Use SOMENTE estes campos: ${fields}. Inclua apenas os que estiver SEGURO de ter lido; ` +
    `use null para os ausentes/ilegíveis. NÃO invente valores. Em "notes", aponte o que ficou ilegível. ` +
    `Números no padrão internacional (ponto decimal).`
  );
}

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

  async extract(input: LaudoInput, kind: LaudoKind): Promise<ExtractedLaudo> {
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
        max_tokens: this.config.maxTokens ?? 600,
        system: systemPrompt(kind),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: input.base64 },
              },
              { type: 'text', text: 'Extraia os campos do laudo conforme o formato JSON pedido.' },
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new LabExtractorError(`JSON inválido do modelo: ${text.slice(0, 120)}`, 'parse');
    }
    // A sanitização é a fronteira de confiança — só campos conhecidos e numéricos.
    return sanitizeExtraction(parsed, kind);
  }

  /** Versão do modelo, para a proveniência da auditoria (NFR10) na confirmação. */
  get modelVersion(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }
}
