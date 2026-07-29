import {
  type IBodyProjector,
  type BodyProjectionInput,
  type BodyProjectionResult,
  BodyProjectorError,
  validateProjectionInput,
} from './projector';
import { buildPrompt } from './gemini-projector';

/**
 * Projeção via OpenAI `gpt-image-1` no endpoint de EDIÇÃO de imagem.
 *
 * Por que existe, já que o Gemini foi o escolhido: medindo contra a API real
 * (2026-07-28), o Gemini preserva a identidade muito bem mas quase não muda o
 * corpo — e a instrução forte o bastante para vencer esse viés é recusada pelo
 * filtro. O `gpt-image-1` tem o defeito oposto: re-renderiza a cena inteira
 * (por isso costuma mexer no rosto), o que o deixa disposto a reestruturar o
 * corpo. O parâmetro `input_fidelity: 'high'` existe justamente para segurar
 * rosto e detalhes da imagem de entrada — é o que torna a troca viável.
 *
 * Usa o MESMO `buildPrompt` do Gemini de propósito: no comparativo o modelo
 * precisa ser a única variável.
 */

export interface OpenAiProjectorConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  /** 'high' preserva rosto/detalhes da entrada; custa mais tokens de entrada. */
  readonly inputFidelity?: 'high' | 'low';
  readonly quality?: 'low' | 'medium' | 'high' | 'auto';
  readonly size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  readonly fetchImpl?: typeof fetch;
  readonly onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/images/edits';
const DEFAULT_MODEL = 'gpt-image-2';

/** Só a família gpt-image-1 aceita `input_fidelity` (ver uso, abaixo). */
function suportaInputFidelity(model: string): boolean {
  return model.startsWith('gpt-image-1');
}

interface OpenAiResponse {
  data?: Array<{ b64_json?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string; type?: string };
}

/** Códigos/tipos que significam recusa por conteúdo, não falha técnica. */
const RECUSA = new Set(['moderation_blocked', 'content_policy_violation', 'image_generation_user_error']);

const MENSAGEM_RECUSA =
  'O modelo recusou editar esta foto (política de conteúdo). Tente outra foto, ' +
  'de preferência de corpo inteiro, com boa iluminação e roupa neutra.';

export class OpenAiBodyProjector implements IBodyProjector {
  constructor(private readonly config: OpenAiProjectorConfig) {
    if (!config.apiKey) {
      throw new BodyProjectorError('apiKey vazia — credencial da OpenAI é obrigatória.', 'config');
    }
  }

  get modelVersion(): string {
    return this.config.model ?? DEFAULT_MODEL;
  }

  async project(input: BodyProjectionInput): Promise<BodyProjectionResult> {
    const invalido = validateProjectionInput(input);
    if (invalido) throw new BodyProjectorError(invalido, 'input');

    // multipart/form-data (não JSON como o Gemini): o endpoint de edição recebe
    // a imagem como ARQUIVO. O content-type com boundary é montado pelo fetch —
    // defini-lo à mão quebra o parse do outro lado.
    const bytes = Buffer.from(input.photoBase64, 'base64');
    const extensao = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType === 'image/webp' ? 'webp' : 'png';
    const form = new FormData();
    form.append('model', this.modelVersion);
    form.append('image', new Blob([bytes], { type: input.mimeType }), `foto.${extensao}`);
    form.append('prompt', buildPrompt(input));
    // `input_fidelity` é da FAMÍLIA gpt-image-1 — mandá-lo para o gpt-image-2 dá
    // 400 ("does not support the 'input_fidelity' parameter"), medido em
    // 2026-07-28. Config explícita vence; senão, só quem suporta recebe.
    const fidelity = this.config.inputFidelity ?? (suportaInputFidelity(this.modelVersion) ? 'high' : null);
    if (fidelity) form.append('input_fidelity', fidelity);
    form.append('quality', this.config.quality ?? 'high');
    form.append('size', this.config.size ?? 'auto');
    form.append('n', '1');

    const doFetch = this.config.fetchImpl ?? fetch;
    const response = await doFetch(this.config.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: form,
    });

    const data = (await response.json().catch(() => ({}))) as OpenAiResponse;

    if (!response.ok) {
      const code = data.error?.code ?? data.error?.type ?? '';
      if (RECUSA.has(code)) throw new BodyProjectorError(MENSAGEM_RECUSA, 'safety');
      // A OpenAI exige verificação da organização para liberar o gpt-image-1 —
      // sem ela devolve 403. É erro de CONFIGURAÇÃO, não de imagem: dizer
      // "tente outra foto" mandaria o médico para o caminho errado.
      if (response.status === 403) {
        throw new BodyProjectorError(
          `Acesso ao ${this.modelVersion} negado — verifique a organização no painel da OpenAI. ` +
            `Detalhe: ${data.error?.message ?? 'sem detalhe'}`,
          'config',
        );
      }
      throw new BodyProjectorError(
        `OpenAI Images falhou (${response.status}): ${data.error?.message ?? 'sem detalhe'}`,
        'api',
      );
    }

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new BodyProjectorError('Resposta da OpenAI sem imagem.', 'parse');

    this.config.onUsage?.({
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    });

    // gpt-image-1 sempre devolve PNG em b64_json (não há URL).
    return { imageBase64: b64, mimeType: 'image/png', modelVersion: this.modelVersion };
  }
}
