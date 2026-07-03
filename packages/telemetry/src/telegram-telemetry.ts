import { PRICING } from './telemetry';

/**
 * Telemetria do canal Telegram (E12/12.9 — NFR7). Em memória, agregada e SEM PII
 * (NFR9): só contadores e custo. Reusa `PRICING` para o custo de visão por foto
 * (mesma tabela do board — visão do Claude usa o mesmo modelo/pricing de tokens).
 *
 * O `chat_id` entra apenas num Set para contar pacientes ativos distintos — nunca
 * é exposto (só o tamanho). Nenhum conteúdo de mensagem/foto trafega aqui.
 */

export interface TelegramTelemetryReport {
  readonly photos: number;
  readonly activePatients: number;
  readonly photosByDay: Readonly<Record<string, number>>;
  readonly vision: {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly usd: number;
  };
}

export class TelegramTelemetry {
  private photos = 0;
  private readonly chats = new Set<string>();
  private readonly byDay = new Map<string, number>();
  private visionCalls = 0;
  private visionInputTokens = 0;
  private visionOutputTokens = 0;

  /** Uma foto processada de um chat, no dia local `dayISO` (conta foto + paciente ativo). */
  photoLogged(chatId: string, dayISO: string): void {
    this.photos += 1;
    this.chats.add(chatId);
    this.byDay.set(dayISO, (this.byDay.get(dayISO) ?? 0) + 1);
  }

  /** Uso de tokens de visão de uma estimativa (custo NFR7). */
  visionUsage(inputTokens: number, outputTokens: number): void {
    this.visionCalls += 1;
    this.visionInputTokens += inputTokens;
    this.visionOutputTokens += outputTokens;
  }

  /** Custo de visão acumulado em USD (pela tabela PRICING). */
  visionUsd(): number {
    return (
      (this.visionInputTokens / 1_000_000) * PRICING.llmInputPerMTok +
      (this.visionOutputTokens / 1_000_000) * PRICING.llmOutputPerMTok
    );
  }

  report(): TelegramTelemetryReport {
    return {
      photos: this.photos,
      activePatients: this.chats.size,
      photosByDay: Object.fromEntries(this.byDay),
      vision: {
        calls: this.visionCalls,
        inputTokens: this.visionInputTokens,
        outputTokens: this.visionOutputTokens,
        usd: this.visionUsd(),
      },
    };
  }
}
