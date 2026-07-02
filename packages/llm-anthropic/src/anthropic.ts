import type {
  ILlmProvider,
  LlmCompletionRequest,
  TextCompletionRequest,
  PersonaContribution,
  PersonaId,
  ContributionType,
  ContributionSeverity,
} from '@nutrimed/providers';

/**
 * Adapter Anthropic (Claude) para `ILlmProvider` (Stories 3.1/3.4 — NFR8).
 *
 * Default: **claude-haiku-4-5** — melhor custo/latência p/ contribuições do
 * board (~2-3k tokens entrada, ~150 saída ⇒ ~US$0,003/contribuição); o tier
 * pode subir por persona (ex.: Sonnet na síntese do Aurélio — E6) trocando só
 * a config. Implementado sobre `fetch` (Messages API) — sem SDK de vendor.
 *
 * O modelo responde JSON `{type, severity, text, relevanceScore}`; `personaId`
 * vem da config (a persona é decisão do orchestrator, não do modelo) e
 * `modelVersion` vem da resposta da API (proveniência NFR10 → auditoria 1.5).
 */

export interface AnthropicLlmConfig {
  readonly apiKey: string;
  readonly personaId: PersonaId;
  readonly model?: string;
  readonly endpoint?: string;
  readonly maxTokens?: number;
  /** Documentos longos (ex.: nota clínica): remove o limite de 1-3 frases. */
  readonly longForm?: boolean;
  /** Telemetria (E10): tokens consumidos por chamada (custo NFR7). */
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  readonly fetchImpl?: typeof fetch;
}

export class AnthropicLlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'api' | 'parse',
  ) {
    super(message);
    this.name = 'AnthropicLlmError';
  }
}

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';

export function anthropicConfigFromEnv(
  personaId: PersonaId,
  env: NodeJS.ProcessEnv = process.env,
): AnthropicLlmConfig {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicLlmError(
      'ANTHROPIC_API_KEY ausente — configure a credencial do LLM no ambiente (.env).',
      'config',
    );
  }
  return { apiKey, personaId };
}

function outputInstructions(longForm: boolean, allowSkip: boolean): string {
  return (
    'Responda APENAS com um objeto JSON válido (sem cercas de código), no formato: ' +
    '{"type":"atencao|sugestao|hipotese|sintese","severity":"normal|critical","text":"...","relevanceScore":0.0}. ' +
    (longForm
      ? 'O campo text deve conter o DOCUMENTO COMPLETO em markdown, com todas as seções e quebras de linha escapadas no JSON, em português do Brasil.'
      : 'O campo text deve ser curto (1-3 frases), em português do Brasil, em tom de sugestão.') +
    (allowSkip
      ? ' IMPORTANTE: se você NÃO tem nada NOVO e útil a acrescentar — algo que você ou um colega do board ' +
        'já disse nesta consulta, MESMO COM OUTRAS PALAVRAS, não é novo — responda APENAS {"skip":true}.'
      : '')
  );
}

interface AnthropicResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

const VALID_TYPES = new Set<ContributionType>(['atencao', 'sugestao', 'hipotese', 'sintese']);
const VALID_SEVERITIES = new Set<ContributionSeverity>(['normal', 'critical']);

export class AnthropicLlmProvider implements ILlmProvider {
  constructor(private readonly config: AnthropicLlmConfig) {
    if (!config.apiKey) {
      throw new AnthropicLlmError('apiKey vazia — credencial da Anthropic é obrigatória.', 'config');
    }
  }

  async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const kbContext =
      req.context.length > 0
        ? `\n\nBase de conhecimento relevante:\n${req.context.map((c) => `- [${c.id}] ${c.text}`).join('\n')}`
        : '';
    // B1 — anti-repetição: o modelo VÊ o que o board já disse nesta consulta
    const priorsBlock = req.priorContributions?.length
      ? `\n\nContribuições JÁ FEITAS pelo board nesta consulta (NÃO repita nenhuma, nem com outras palavras):\n${req.priorContributions
          .map((p) => `- ${p}`)
          .join('\n')}`
      : '';

    const response = await doFetch(this.config.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: this.config.maxTokens ?? 300,
        system: `${req.system}\n\n${outputInstructions(this.config.longForm ?? false, req.allowSkip ?? false)}`,
        messages: [
          {
            role: 'user',
            content: `Transcrição recente da consulta:\n"""${req.transcript}"""${kbContext}${priorsBlock}`,
          },
        ],
      }),
    });

    const data = (await response.json()) as AnthropicResponse;
    if (!response.ok) {
      throw new AnthropicLlmError(
        `Messages API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }

    this.config.onUsage?.({
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });

    const text = data.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new AnthropicLlmError('Resposta sem bloco de texto.', 'parse');

    const parsed = parseContribution(text);
    if (parsed.skip) {
      // B1: o modelo declarou não ter nada novo — o orchestrator descarta
      return {
        personaId: this.config.personaId,
        type: 'sugestao',
        severity: 'normal',
        text: '',
        skip: true,
        modelVersion: data.model ?? this.config.model ?? DEFAULT_MODEL,
      };
    }
    return {
      personaId: this.config.personaId,
      type: parsed.type,
      severity: parsed.severity,
      text: parsed.text,
      relevanceScore: parsed.relevanceScore,
      triggeredBy: undefined, // o orchestrator conhece o gatilho, não o modelo
      kbSources: req.context.map((c) => c.id),
      modelVersion: data.model ?? this.config.model ?? DEFAULT_MODEL,
    };
  }

  /**
   * B3 — completion de texto livre (CaseState/case review): mesma Messages API,
   * sem o contrato JSON de contribuição. Também reporta usage (custo E10).
   */
  async completeText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
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
        max_tokens: req.maxTokens ?? 400,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
      }),
    });
    const data = (await response.json()) as AnthropicResponse;
    if (!response.ok) {
      throw new AnthropicLlmError(
        `Messages API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }
    this.config.onUsage?.({
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });
    const text = data.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new AnthropicLlmError('Resposta sem bloco de texto.', 'parse');
    return { text, modelVersion: data.model ?? this.config.model ?? DEFAULT_MODEL };
  }
}

interface ParsedContribution {
  type: ContributionType;
  severity: ContributionSeverity;
  text: string;
  relevanceScore?: number;
  skip?: true;
}

/** Parse tolerante do JSON do modelo (aceita cercas de código por robustez). */
export function parseContribution(raw: string): ParsedContribution {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new AnthropicLlmError(`JSON inválido do modelo: ${raw.slice(0, 120)}`, 'parse');
  }
  if (obj.skip === true) {
    return { type: 'sugestao', severity: 'normal', text: '', skip: true };
  }
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) throw new AnthropicLlmError('Contribuição sem texto.', 'parse');
  const type = VALID_TYPES.has(obj.type as ContributionType)
    ? (obj.type as ContributionType)
    : 'sugestao';
  const severity = VALID_SEVERITIES.has(obj.severity as ContributionSeverity)
    ? (obj.severity as ContributionSeverity)
    : 'normal';
  const relevanceScore = typeof obj.relevanceScore === 'number' ? obj.relevanceScore : undefined;
  return { type, severity, text, relevanceScore };
}
