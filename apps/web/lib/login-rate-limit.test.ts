import { describe, it, expect } from 'vitest';
import { createLoginRateLimiter, formatRetry } from './login-rate-limit';

const IP = '203.0.113.7';
const OTHER_IP = '203.0.113.8';

describe('login-rate-limit (anti brute-force)', () => {
  it('libera até o limite e bloqueia a partir dele (por IP+conta)', () => {
    const rl = createLoginRateLimiter({ max: 3, windowMs: 60_000 }, { max: 100, windowMs: 60_000 });
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rl.check(IP, 'rafael', t).blocked).toBe(false);
      rl.recordFailure(IP, 'rafael', t);
    }
    const d = rl.check(IP, 'rafael', t);
    expect(d.blocked).toBe(true);
    expect(d.retryAfterSec).toBeGreaterThan(0);
  });

  it('o bloqueio expira quando as falhas saem da janela (sliding)', () => {
    const rl = createLoginRateLimiter({ max: 2, windowMs: 60_000 }, { max: 100, windowMs: 60_000 });
    const t = 1_000_000;
    rl.recordFailure(IP, 'rafael', t);
    rl.recordFailure(IP, 'rafael', t + 1_000);
    expect(rl.check(IP, 'rafael', t + 2_000).blocked).toBe(true);
    // 60s após a 1ª falha, ela some da janela ⇒ conta cai para 1 ⇒ liberado
    expect(rl.check(IP, 'rafael', t + 61_000).blocked).toBe(false);
  });

  it('sucesso zera a conta (usuário legítimo não fica penalizado)', () => {
    const rl = createLoginRateLimiter({ max: 3, windowMs: 60_000 }, { max: 100, windowMs: 60_000 });
    const t = 1_000_000;
    rl.recordFailure(IP, 'rafael', t);
    rl.recordFailure(IP, 'rafael', t);
    rl.resetAccount(IP, 'rafael');
    expect(rl.check(IP, 'rafael', t).blocked).toBe(false);
  });

  it('escopo por IP: falhas de um IP não bloqueiam outro IP', () => {
    const rl = createLoginRateLimiter({ max: 2, windowMs: 60_000 }, { max: 100, windowMs: 60_000 });
    const t = 1_000_000;
    rl.recordFailure(IP, 'rafael', t);
    rl.recordFailure(IP, 'rafael', t);
    expect(rl.check(IP, 'rafael', t).blocked).toBe(true);
    expect(rl.check(OTHER_IP, 'rafael', t).blocked).toBe(false);
  });

  it('trava spraying: várias contas do MESMO IP estouram o limite por IP', () => {
    const rl = createLoginRateLimiter({ max: 100, windowMs: 60_000 }, { max: 3, windowMs: 60_000 });
    const t = 1_000_000;
    rl.recordFailure(IP, 'a@x', t);
    rl.recordFailure(IP, 'b@x', t);
    rl.recordFailure(IP, 'c@x', t);
    // conta 'd@x' nunca falhou, mas o IP já estourou ⇒ bloqueado
    expect(rl.check(IP, 'd@x', t).blocked).toBe(true);
  });

  it('e-mail é normalizado (case/espaço) na chave da conta', () => {
    const rl = createLoginRateLimiter({ max: 2, windowMs: 60_000 }, { max: 100, windowMs: 60_000 });
    const t = 1_000_000;
    rl.recordFailure(IP, 'Rafael.Bastos', t);
    rl.recordFailure(IP, '  rafael.bastos  ', t);
    expect(rl.check(IP, 'RAFAEL.BASTOS', t).blocked).toBe(true);
  });

  it('formatRetry: segundos vs minutos', () => {
    expect(formatRetry(45)).toBe('45 s');
    expect(formatRetry(60)).toBe('1 min');
    expect(formatRetry(150)).toBe('3 min');
  });
});
