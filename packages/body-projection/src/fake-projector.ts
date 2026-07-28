import {
  type IBodyProjector,
  type BodyProjectionInput,
  type BodyProjectionResult,
  BodyProjectorError,
  validateProjectionInput,
} from './projector';

/**
 * Gerador determinístico (sem rede) — testes e desenvolvimento local sem
 * credencial nem custo. Devolve a PRÓPRIA foto enviada: o fluxo inteiro
 * (upload → geração → aprovação do médico → apresentação) fica exercitável, e
 * o `modelVersion` gravado na auditoria deixa explícito que não houve IA.
 */
export class FakeBodyProjector implements IBodyProjector {
  readonly modelVersion = 'fake-projector';

  async project(input: BodyProjectionInput): Promise<BodyProjectionResult> {
    const invalido = validateProjectionInput(input);
    if (invalido) throw new BodyProjectorError(invalido, 'input');

    return {
      imageBase64: input.photoBase64,
      mimeType: input.mimeType,
      modelVersion: this.modelVersion,
    };
  }
}
