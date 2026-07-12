import { describe, it, expect, vi } from 'vitest';
import { createErrorReporter, type ErrorInfo } from './alert';

const base: ErrorInfo = { message: 'boom', name: 'Error', path: '/consultations/x', method: 'POST' };

describe('error reporter (alerta de produção)', () => {
  it('envia a primeira ocorrência com rota, digest e hora', async () => {
    const send = vi.fn<(t: string) => void>();
    const rl = createErrorReporter(send);
    const status = await rl.report({ ...base, digest: 'abc123' }, 1_000_000);
    expect(status).toBe('sent');
    const text = send.mock.calls[0]![0];
    expect(text).toContain('POST /consultations/x');
    expect(text).toContain('Error: boom');
    expect(text).toContain('digest: abc123');
  });

  it('deduplica o mesmo erro dentro da janela e reenvia após ela', async () => {
    const send = vi.fn();
    const rl = createErrorReporter(send, { dedupeMs: 60_000 });
    const t = 1_000_000;
    expect(await rl.report(base, t)).toBe('sent');
    expect(await rl.report(base, t + 5_000)).toBe('throttled');
    expect(await rl.report(base, t + 61_000)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('erros de rotas diferentes não deduplicam entre si', async () => {
    const send = vi.fn();
    const rl = createErrorReporter(send, { dedupeMs: 60_000 });
    const t = 1_000_000;
    expect(await rl.report({ ...base, path: '/a' }, t)).toBe('sent');
    expect(await rl.report({ ...base, path: '/b' }, t)).toBe('sent');
  });

  it('teto global (anti-storm) bloqueia além do máximo na janela', async () => {
    const send = vi.fn();
    const rl = createErrorReporter(send, { dedupeMs: 1, globalMax: 3, globalWindowMs: 60_000 });
    const t = 1_000_000;
    // 3 assinaturas distintas passam; a 4ª (nova) é barrada pelo teto global
    expect(await rl.report({ ...base, path: '/1' }, t)).toBe('sent');
    expect(await rl.report({ ...base, path: '/2' }, t)).toBe('sent');
    expect(await rl.report({ ...base, path: '/3' }, t)).toBe('sent');
    expect(await rl.report({ ...base, path: '/4' }, t)).toBe('throttled');
  });

  it('ignora redirect/notFound do Next (não alerta fluxo de controle)', async () => {
    const send = vi.fn();
    const rl = createErrorReporter(send);
    expect(await rl.report({ message: 'NEXT_REDIRECT', digest: 'NEXT_REDIRECT;replace;/login;307;' }, 1)).toBe('skipped');
    expect(await rl.report({ message: 'x', digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }, 2)).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('falha no envio não lança (retorna error)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('rede caiu'));
    const rl = createErrorReporter(send);
    await expect(rl.report(base, 1_000_000)).resolves.toBe('error');
  });
});
