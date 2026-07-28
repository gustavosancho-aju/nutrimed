import {
  type IBodyProjector,
  type BodyProjectionInput,
  type BodyProjectionResult,
  BodyProjectorError,
  bmiFrom,
  validateProjectionInput,
} from './projector';

/**
 * Projeção via Gemini no modo EDIÇÃO (imagem + texto → imagem), pelo mesmo
 * endpoint REST que `scripts/gen-personas.mjs` já usa para os retratos das
 * personas — `fetch` direto, sem SDK, como nos demais adapters do repo.
 *
 * Por que Gemini e não outro: o que decide aqui é preservar a IDENTIDADE do
 * paciente (rosto, pele, cabelo, roupa, fundo) mudando só a silhueta. Se o
 * rosto muda, a imagem perde o sentido clínico — vira a foto de outra pessoa.
 */

export interface GeminiProjectorConfig {
  readonly apiKey: string;
  readonly model?: string;
  /** Base da API (sem o modelo) — sobrescrito nos testes. */
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash-image';

/**
 * O prompt vai em INGLÊS de propósito (o resto do repo comenta em pt-BR): os
 * modelos de imagem seguem instrução de preservação com bem mais fidelidade em
 * inglês, e aqui a instrução que não pode falhar é "não mexa no rosto".
 *
 * Exportado para o script POC imprimir exatamente o que foi enviado.
 */
export function buildPrompt(input: BodyProjectionInput): string {
  const perdendo = input.targetWeightKg < input.currentWeightKg;
  const direcao = perdendo ? 'weight loss' : 'weight gain';
  const delta = Math.abs(input.targetWeightKg - input.currentWeightKg).toFixed(1);

  const imc = input.heightCm
    ? ` This corresponds to a BMI change from ${bmiFrom(input.currentWeightKg, input.heightCm).toFixed(1)} to ${bmiFrom(input.targetWeightKg, input.heightCm).toFixed(1)}.`
    : '';
  const sexo = input.sex ? (input.sex === 'F' ? ' The patient is female.' : ' The patient is male.') : '';

  return (
    `Edit this photograph for a medical weight-management consultation. ` +
    `The person currently weighs ${input.currentWeightKg.toFixed(1)} kg and the treatment goal is ` +
    `${input.targetWeightKg.toFixed(1)} kg — a ${direcao} of ${delta} kg.${imc}${sexo} ` +
    `Show the SAME person at the target weight.\n\n` +
    `MUST PRESERVE, unchanged and recognisable: the face and all facial features, the identity, ` +
    `age, skin tone, hair, glasses or accessories, the clothing and its style, the body pose, ` +
    `the camera angle and framing, the background and the lighting.\n\n` +
    `MUST CHANGE, and nothing else: body composition and silhouette — the distribution of body fat ` +
    `consistent with the weight change, in an anatomically plausible way and proportional to the ` +
    `stated difference.\n\n` +
    `Keep it clinical, realistic and dignified: no exaggeration, no idealised or athletic body, ` +
    `no added muscle definition, no beautification of the face or skin, no slimming of the face ` +
    `beyond what the weight change justifies, no sexualisation. Keep the original image dimensions. ` +
    `Return a single edited photograph.`
  );
}

interface GeminiPart {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

/** finishReason/blockReason que significam "o modelo recusou", não "deu erro". */
const RECUSA = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION']);

const MENSAGEM_RECUSA =
  'O modelo recusou editar esta foto (política de conteúdo). Tente outra foto, ' +
  'de preferência de corpo inteiro, com boa iluminação e roupa neutra.';

export class GeminiBodyProjector implements IBodyProjector {
  constructor(private readonly config: GeminiProjectorConfig) {
    if (!config.apiKey) {
      throw new BodyProjectorError('apiKey vazia — credencial do Gemini é obrigatória.', 'config');
    }
  }

  get modelVersion(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }

  async project(input: BodyProjectionInput): Promise<BodyProjectionResult> {
    const invalido = validateProjectionInput(input);
    if (invalido) throw new BodyProjectorError(invalido, 'input');

    const doFetch = this.config.fetchImpl ?? fetch;
    const base = this.config.endpoint ?? DEFAULT_ENDPOINT;

    // A key vai no HEADER, não na query string como em gen-personas.mjs: aqui
    // isto roda no servidor, e URL de request vaza em log/stack de erro.
    const response = await doFetch(`${base}/${this.modelVersion}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: input.mimeType, data: input.photoBase64 } },
              { text: buildPrompt(input) },
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });

    const data = (await response.json().catch(() => ({}))) as GeminiResponse;

    if (!response.ok) {
      if (data.error?.status && RECUSA.has(data.error.status)) {
        throw new BodyProjectorError(MENSAGEM_RECUSA, 'safety');
      }
      throw new BodyProjectorError(
        `Gemini falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }

    // Recusa vem como 200 com candidato sem imagem — tratar como 'safety' e não
    // como 'parse' faz diferença na UI: o médico precisa saber que o caminho é
    // trocar a foto, não tentar de novo.
    const candidate = data.candidates?.[0];
    if (data.promptFeedback?.blockReason || (candidate?.finishReason && RECUSA.has(candidate.finishReason))) {
      throw new BodyProjectorError(MENSAGEM_RECUSA, 'safety');
    }

    const parte = candidate?.content?.parts?.find((p) => p.inlineData?.data ?? p.inline_data?.data);
    const dados = parte?.inlineData?.data ?? parte?.inline_data?.data;
    if (!dados) {
      throw new BodyProjectorError('Resposta do Gemini sem imagem.', 'parse');
    }

    this.config.onUsage?.({
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    });

    return {
      imageBase64: dados,
      mimeType: parte?.inlineData?.mimeType ?? parte?.inline_data?.mime_type ?? 'image/png',
      modelVersion: this.modelVersion,
    };
  }
}
