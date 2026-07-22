import { stripJsonFences } from '@nutrimed/providers';
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
 * Adapter Kimi/Moonshot para `ILlmProvider` (NFR8/ADR-002 — mesmo padrão do
 * @nutrimed/llm-anthropic, sem SDK de vendor).
 *
 * Default: **kimi-k3** (contexto de 1M tokens) via API OpenAI-compatível
 * (`/v1/chat/completions`). O K3 é um modelo "thinking": o raciocínio vem em
 * `reasoning_content` (descartado) e a resposta em `message.content`;
 * `reasoning_effort` default 'low' — documentos (nota/relatório) não precisam
 * do esforço máximo e a latência importa para o médico que espera na tela.
 *
 * Papel no sistema (decisão 2026-07-21): nota clínica + relatório nutricional
 * (documentos longos). Board ao vivo e visão seguem no Claude.
 */

export interface KimiLlmConfig {
  readonly apiKey: string;
  readonly personaId: PersonaId;
  readonly model?: string;
  readonly endpoint?: string;
  readonly maxTokens?: number;
  /** Esforço de raciocínio do K3: 'low' | 'high' | 'max' (default 'low'). */
  readonly reasoningEffort?: 'low' | 'high' | 'max';
  /** Documentos longos (ex.: nota clínica): remove o limite de 1-3 frases. */
  readonly longForm?: boolean;
  /** Telemetria (E10): tokens consumidos por chamada (custo NFR7). */
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  readonly fetchImpl?: typeof fetch;
}

export class KimiLlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'api' | 'parse',
  ) {
    super(message);
    this.name = 'KimiLlmError';
  }
}

const DEFAULT_ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
const DEFAULT_MODEL = 'kimi-k3';

function outputInstructions(longForm: boolean, allowSkip: boolean): string {
  return (
    'Responda APENAS com um objeto JSON válido (sem cercas de código), no formato: ' +
    '{"type":"atencao|sugestao|hipotese|sintese","severity":"normal|critical","text":"...","relevanceScore":0.0}. ' +
    (longForm
      ? 'O campo text deve conter o DOCUMENTO COMPLETO em markdown, com todas as seções e quebras de linha escapadas no JSON, em português do Brasil.'
      : 'O campo text deve ser curto (1-3 frases), em português do Brasil, em tom de sugestão.') +
    (allowSkip
      ? ' IMPORTANTE: responda APENAS {"skip":true} quando você NÃO tiver nada NOVO e útil a acrescentar ' +
        'ao que o board já disse nesta consulta, mesmo com outras palavras.'
      : '')
  );
}

interface KimiResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

const VALID_TYPES = new Set<ContributionType>(['atencao', 'sugestao', 'hipotese', 'sintese']);
const VALID_SEVERITIES = new Set<ContributionSeverity>(['normal', 'critical']);

export class KimiLlmProvider implements ILlmProvider {
  constructor(private readonly config: KimiLlmConfig) {
    if (!config.apiKey) {
      throw new KimiLlmError('apiKey vazia — credencial da Moonshot é obrigatória.', 'config');
    }
  }

  /** Versão do modelo, para a proveniência da auditoria (NFR10). */
  get modelVersion(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }

  private async chat(system: string, user: string, maxTokens: number): Promise<{ text: string; model: string }> {
    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(this.config.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model ?? DEFAULT_MODEL,
        max_tokens: maxTokens,
        reasoning_effort: this.config.reasoningEffort ?? 'low',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    const data = (await response.json()) as KimiResponse;
    if (!response.ok) {
      throw new KimiLlmError(
        `Chat Completions API falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }
    this.config.onUsage?.({
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    });
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new KimiLlmError('Resposta sem conteúdo de texto.', 'parse');
    return { text, model: data.model ?? this.config.model ?? DEFAULT_MODEL };
  }

  async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
    const kbContext =
      req.context.length > 0
        ? `\n\nBase de conhecimento relevante:\n${req.context.map((c) => `- [${c.id}] ${c.text}`).join('\n')}`
        : '';
    const priorsBlock = req.priorContributions?.length
      ? `\n\nContribuições JÁ FEITAS pelo board nesta consulta (NÃO repita nenhuma, nem com outras palavras):\n${req.priorContributions
          .map((p) => `- ${p}`)
          .join('\n')}`
      : '';

    const { text, model } = await this.chat(
      `${req.system}\n\n${outputInstructions(this.config.longForm ?? false, req.allowSkip ?? false)}`,
      `Transcrição recente da consulta:\n"""${req.transcript}"""${kbContext}${priorsBlock}`,
      this.config.maxTokens ?? 600,
    );

    const parsed = parseKimiContribution(text);
    if (parsed.skip) {
      return {
        personaId: this.config.personaId,
        type: 'sugestao',
        severity: 'normal',
        text: '',
        skip: true,
        modelVersion: model,
      };
    }
    return {
      personaId: this.config.personaId,
      type: parsed.type,
      severity: parsed.severity,
      text: parsed.text,
      relevanceScore: parsed.relevanceScore,
      triggeredBy: undefined,
      kbSources: req.context.map((c) => c.id),
      modelVersion: model,
    };
  }

  /** Completion de texto livre — caminho usado pela nota clínica e pelo relatório nutricional. */
  async completeText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
    const { text, model } = await this.chat(req.system, req.prompt, req.maxTokens ?? 1000);
    return { text, modelVersion: model };
  }
}

interface ParsedKimiContribution {
  type: ContributionType;
  severity: ContributionSeverity;
  text: string;
  relevanceScore?: number;
  skip?: true;
}

/** Parse tolerante do JSON do modelo (aceita cercas de código por robustez). */
export function parseKimiContribution(raw: string): ParsedKimiContribution {
  const cleaned = stripJsonFences(raw);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new KimiLlmError(`JSON inválido do modelo: ${raw.slice(0, 120)}`, 'parse');
  }
  if (obj.skip === true) return { type: 'sugestao', severity: 'normal', text: '', skip: true };
  const type = VALID_TYPES.has(obj.type as ContributionType) ? (obj.type as ContributionType) : 'sugestao';
  const severity = VALID_SEVERITIES.has(obj.severity as ContributionSeverity)
    ? (obj.severity as ContributionSeverity)
    : 'normal';
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!text) throw new KimiLlmError('Contribuição sem campo text.', 'parse');
  const relevanceScore = typeof obj.relevanceScore === 'number' ? obj.relevanceScore : undefined;
  return { type, severity, text, relevanceScore };
}
