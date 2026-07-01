import { describe, it, expect } from 'vitest';
import { TelegramTelemetry } from './telegram-telemetry';
import { PRICING } from './telemetry';

describe('TelegramTelemetry (E12/12.9 — NFR7, sem PII)', () => {
  it('conta fotos, pacientes ativos distintos e fotos por dia', () => {
    const t = new TelegramTelemetry();
    t.photoLogged('chat-A', '2026-07-01');
    t.photoLogged('chat-A', '2026-07-01'); // mesmo paciente, 2ª foto
    t.photoLogged('chat-B', '2026-07-02');

    const r = t.report();
    expect(r.photos).toBe(3);
    expect(r.activePatients).toBe(2); // A e B distintos
    expect(r.photosByDay).toEqual({ '2026-07-01': 2, '2026-07-02': 1 });
  });

  it('calcula o custo de visão pela tabela PRICING', () => {
    const t = new TelegramTelemetry();
    t.visionUsage(1_000_000, 200_000); // 1M in, 0.2M out
    const esperado = 1 * PRICING.llmInputPerMTok + 0.2 * PRICING.llmOutputPerMTok;

    const r = t.report();
    expect(r.vision.calls).toBe(1);
    expect(r.vision.inputTokens).toBe(1_000_000);
    expect(r.vision.usd).toBeCloseTo(esperado, 6);
  });

  it('zerado por padrão (sem fotos ⇒ custo 0)', () => {
    const r = new TelegramTelemetry().report();
    expect(r.photos).toBe(0);
    expect(r.activePatients).toBe(0);
    expect(r.vision.usd).toBe(0);
  });
});
