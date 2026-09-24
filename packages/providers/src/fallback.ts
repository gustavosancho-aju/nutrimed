import type { ILlmProvider, LlmCompletionRequest, TextCompletionRequest } from './interfaces';
import type { PersonaContribution } from './types';

/**
 * Encadeia dois provedores de LLM: tenta o primário e, se ele FALHAR (cota
 * esgotada, 429, 5xx, rede, resposta ilegível), repete a MESMA chamada no
 * reserva. Nasceu do incidente de 2026-09-24: a conta do Kimi foi suspensa por
 * saldo e nota + ficha pararam, com o Claude funcionando ao lado.
 *
 * Não há "circuito aberto" de propósito: um 429 de cota volta em
 * milissegundos, e tentar o primário a cada chamada faz o sistema voltar
 * sozinho assim que o saldo for recarregado.
 *
 * O `modelVersion` retornado é o de quem RESPONDEU — a auditoria (NFR10)
 * registra o modelo que de fato escreveu o documento.
 */
export class FallbackLlmProvider implements ILlmProvider {
  constructor(
    private readonly primary: ILlmProvider,
    private readonly fallback: ILlmProvider,
    private readonly onFallback: (err: unknown) => void = () => {},
  ) {}

  async complete(req: LlmCompletionRequest): Promise<PersonaContribution> {
    try {
      return await this.primary.complete(req);
    } catch (err) {
      this.onFallback(err);
      return this.fallback.complete(req);
    }
  }

  async completeText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
    if (!this.primary.completeText) return this.fallbackText(req);
    try {
      return await this.primary.completeText(req);
    } catch (err) {
      this.onFallback(err);
      return this.fallbackText(req);
    }
  }

  private fallbackText(req: TextCompletionRequest): Promise<{ text: string; modelVersion?: string }> {
    if (!this.fallback.completeText) {
      throw new Error('Provedor reserva não implementa completeText.');
    }
    return this.fallback.completeText(req);
  }
}
