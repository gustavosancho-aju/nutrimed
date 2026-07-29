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
 * Quanto da massa corporal muda — é ISSO que dá escala ao modelo. "18 kg" não
 * diz nada sozinho: 18 kg num paciente de 150 kg é outra coisa que 18 kg num de
 * 90 kg. A frase de magnitude nasce daqui.
 */
function magnitude(pct: number): string {
  if (pct >= 20) return 'a dramatic, unmistakable transformation';
  if (pct >= 10) return 'a substantial, clearly visible change';
  if (pct >= 5) return 'a clearly noticeable change';
  return 'a modest but still perceptible change';
}

/**
 * Categoria de IMC pela OMS, em inglês. É a âncora VISUAL mais forte que
 * achamos: "render this person as overweight (BMI 26.8)" produz mudança de
 * verdade, enquanto "perca 26 kg" produzia a mesma pessoa — o modelo sabe como
 * cada categoria se parece, mas não sabe converter subtração em silhueta.
 */
function categoriaImc(bmi: number): string {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'a normal, healthy weight';
  if (bmi < 30) return 'overweight';
  if (bmi < 35) return 'obesity class I';
  if (bmi < 40) return 'obesity class II';
  return 'obesity class III';
}

/**
 * Descrição ANATÔMICA do que muda. A 1ª versão do prompt dizia só "distribuição
 * de gordura consistente com a mudança de peso" — abstrato demais: o modelo
 * devolvia a mesma pessoa. Modelo de imagem responde a descrição visual
 * concreta (cintura, papada, contorno do maxilar), não a conceito clínico.
 */
function anatomia(perdendo: boolean): string {
  return perdendo
    ? '- the waist and abdomen are visibly narrower; the belly is flatter and projects much less\n' +
        '- the chest, ribcage and back are slimmer; the neck is thinner\n' +
        '- the arms and thighs are noticeably less thick\n' +
        '- the face is leaner: cheeks less full, the jawline and chin clearly more defined, little or no double chin'
    : '- the waist and abdomen are fuller and rounder\n' +
        '- the chest, ribcage and back are broader; the neck is thicker\n' +
        '- the arms and thighs are noticeably fuller\n' +
        '- the face is fuller: rounder cheeks, a softer jawline';
}

/**
 * O prompt vai em INGLÊS de propósito (o resto do repo comenta em pt-BR): os
 * modelos de imagem seguem instrução visual com mais fidelidade em inglês.
 *
 * Reescrito em 2026-07-28 depois de duas simulações reais do médico saírem com
 * o corpo praticamente igual. A versão anterior empilhava travas de contenção
 * ("no exaggeration", "no idealised body", "no slimming of the face beyond…")
 * contra UMA frase abstrata sobre o que mudar — com o peso todo da instrução no
 * lado da preservação, o modelo jogava seguro e não mexia em nada. Agora:
 * estado-alvo em IMC + categoria da OMS, anatomia concreta, proibição explícita
 * de copiar as proporções atuais, e a roupa passa a VESTIR o novo corpo
 * (mantê-la idêntica ancorava a silhueta: é a roupa que desenha o contorno).
 *
 * LIMITE CONHECIDO (medido, não suposto): mesmo assim o gemini-2.5-flash-image
 * muda POUCO o corpo. Três estratégias foram testadas contra a API real, com
 * foto sintética de corpo inteiro, 108 kg → 82 kg (24% da massa):
 *   1. imperativa ("THE DIFFERENCE MUST BE OBVIOUS", "failed result")
 *      ⇒ RECUSADA por política de conteúdo, de forma determinística;
 *   2. magnitude em % + anatomia concreta ⇒ passa, mudança sutil demais;
 *   3. IMC de destino + categoria OMS (esta) ⇒ passa, ainda sutil.
 * A leitura é que o adapter de EDIÇÃO do modelo é enviesado a preservar a
 * imagem de entrada, e a força de instrução necessária para vencer esse viés é
 * justamente a que dispara o filtro. Não é problema de redação: para diferença
 * realmente visível, o caminho é outro modelo (ver ADR/IBodyProjector).
 *
 * Exportado para o script POC imprimir exatamente o que foi enviado.
 */
export function buildPrompt(input: BodyProjectionInput): string {
  const perdendo = input.targetWeightKg < input.currentWeightKg;
  const delta = Math.abs(input.targetWeightKg - input.currentWeightKg);
  const pct = (delta / input.currentWeightKg) * 100;

  // Estado de DESTINO em termos absolutos. A âncora é a categoria de IMC, não a
  // diferença de peso: pedir "perca 26 kg" devolvia a mesma pessoa, porque o
  // modelo não converte subtração em silhueta — mas ele sabe muito bem como um
  // corpo "overweight" difere de um "obesity class II".
  const alvo = input.heightCm
    ? `This is a person of ${input.heightCm.toFixed(0)} cm. At ${input.currentWeightKg.toFixed(1)} kg their BMI is ` +
      `${bmiFrom(input.currentWeightKg, input.heightCm).toFixed(1)} — ${categoriaImc(bmiFrom(input.currentWeightKg, input.heightCm))}. ` +
      `Redraw them at ${input.targetWeightKg.toFixed(1)} kg, BMI ${bmiFrom(input.targetWeightKg, input.heightCm).toFixed(1)} — ` +
      `${categoriaImc(bmiFrom(input.targetWeightKg, input.heightCm))}. Give them the body of someone in that category.`
    : `The person weighs ${input.currentWeightKg.toFixed(1)} kg. Redraw them at ${input.targetWeightKg.toFixed(1)} kg.`;
  const sexo = input.sex ? ` The patient is ${input.sex === 'F' ? 'female' : 'male'}.` : '';

  return (
    `Edit this photograph for a medical weight-management consultation.\n\n` +
    `${alvo}${sexo} That is ${pct.toFixed(0)}% of their body mass — ${magnitude(pct)}.\n\n` +
    `Do not copy the current body proportions: the whole point is that the body must match the new ` +
    `weight. Anatomically, at the target weight:\n${anatomia(perdendo)}\n\n` +
    `Keep the person recognisable: same face and identity, same age, same skin tone, same hair, same ` +
    `glasses or accessories, same pose, same camera angle and framing, same background, same lighting. ` +
    `Same clothes too — same garment, same colour, same style — but they must now fit the new body: ` +
    `${perdendo ? 'looser, hanging more loosely, no longer stretched tight' : 'filled out more, tighter across the body'}.\n\n` +
    `Make it a real, plausible body at ${input.targetWeightKg.toFixed(1)} kg — not an athletic or idealised ` +
    `one. Do not add muscle definition, do not retouch or beautify the face, no sexualisation. Keep the ` +
    `original image dimensions. Return a single edited photograph.`
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
