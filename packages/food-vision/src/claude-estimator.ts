import {
  type IFoodEstimator,
  type FoodImageInput,
  type FoodEstimate,
  KNOWN_NUTRIENTS,
  sanitizeFoodEstimate,
} from './estimator';

/**
 * Estimador via Claude lendo a FOTO nativamente (visão). Envia a imagem como
 * content block `image` (base64) à Messages API — mesmo padrão `fetch` (sem SDK)
 * de `@nutrimed/llm-anthropic` e `@nutrimed/lab-import`. Produz uma estimativa
 * APROXIMADA (ADR-015); a sanitização é a fronteira de confiança.
 *
 * O canal (API direta vs. Bedrock/Vertex) é reavaliável na comercialização sem
 * mudar o resto — esta classe está atrás de `IFoodEstimator` (NFR8/ADR-002).
 */

export interface ClaudeFoodEstimatorConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly maxTokens?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export class FoodEstimatorError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'api' | 'parse',
  ) {
    super(message);
    this.name = 'FoodEstimatorError';
  }
}

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';

function systemPrompt(): string {
  const fields = KNOWN_NUTRIENTS.join(', ');
  return (
    'Você estima os nutrientes de uma FOTO de prato de comida, para acompanhamento ' +
    'nutricional. É uma estimativa APROXIMADA (não uma medida laboratorial). Observe a ' +
    'foto e retorne APENAS um objeto JSON válido (sem cercas de código) no formato ' +
    '{"values":{"kcal":number,"protein":number,"carbs":number,"fat":number},' +
    '"confidence":"low"|"medium"|"high","itemsLabel":"...","notes":"..."}. ' +
    `Use SOMENTE estes campos em values: ${fields} (kcal total do prato; proteína/carbo/gordura em gramas). ` +
    '"confidence" reflete sua incerteza (porção, ângulo, itens ocultos). "itemsLabel" lista os ' +
    'alimentos reconhecidos. NÃO invente precisão que a foto não permite. Números no padrão ' +
    'internacional (ponto decimal).'
  );
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

export class ClaudeFoodEstimator implements IFoodEstimator {
  constructor(private readonly config: ClaudeFoodEstimatorConfig) {
    if (!config.apiKey) {
      throw new FoodEstimatorError('apiKey vazia — credencial da Anthropic é obrigatória.', 'config');
    }
  }

  async estimate(input: FoodImageInput, hint?: string): Promise<FoodEstimate> {
    const doFetch = this.config.fetchImpl ?? fetch;
    // Descrição/correção do paciente orienta a IDENTIFICAÇÃO; porções vêm da foto.
    // Truncada para limitar a superfície de injeção — a sanitização segue sendo a fronteira.
    const cleanHint = hint?.trim().slice(0, 300);
    const ask = 'Estime os nutrientes deste prato conforme o formato JSON pedido.';
    const askWithHint = cleanHint
      ? `${ask}\nO paciente descreveu o prato assim: "${cleanHint}". Use essa descrição para ` +
        'identificar os alimentos (ela corrige o que a foto pode enganar), mas estime as ' +
        'porções pela foto. Continue retornando APENAS o JSON pedido.'
      : ask;
    const response = await doFetch(this.config.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: this.config.maxTokens ?? 400,
        system: systemPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: input.mediaType, data: input.base64 },
              },
              { type: 'text', text: askWithHint },
            ],
          },
        ],
      }),
    });

    const data = (await response.json()) as AnthropicResponse;
    if (!response.ok) {
      throw new FoodEstimatorError(
        `Messages API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }
    this.config.onUsage?.({
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });

    const text = data.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new FoodEstimatorError('Resposta sem bloco de texto.', 'parse');

    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new FoodEstimatorError(`JSON inválido do modelo: ${text.slice(0, 120)}`, 'parse');
    }
    // A sanitização é a fronteira de confiança — só nutrientes conhecidos e numéricos.
    return sanitizeFoodEstimate(parsed);
  }

  /** Versão do modelo, para a proveniência da auditoria (NFR10) no registro. */
  get modelVersion(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }
}
