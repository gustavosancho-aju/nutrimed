/**
 * Rate limiter em memória para o login (anti brute-force). O estado vive no
 * processo do servidor — sobrevive a requisições, reinicia no deploy. Sliding
 * window de FALHAS por chave, com duas dimensões:
 *  - por (IP + conta): trava um ataque focado numa conta a partir de um IP;
 *  - por IP: trava spraying de várias contas do mesmo IP.
 * Ambas são escopadas por IP de propósito — evita o DoS de lockout (um atacante
 * trancar a conta de um médico legítimo martelando o e-mail dele de fora).
 *
 * Single-machine (1 Fly). Escala multi-instância exigiria store compartilhado
 * (Redis) + provavelmente captcha para ataques distribuídos.
 */

export interface RateWindow {
  readonly max: number;
  readonly windowMs: number;
}

export interface RateDecision {
  readonly blocked: boolean;
  readonly retryAfterSec: number;
}

export interface LoginRateLimiter {
  /** Decisão ANTES de checar a senha (bloqueia se conta OU IP estourou). */
  check(ip: string, email: string, now: number): RateDecision;
  /** Registra uma falha de senha (conta + IP). */
  recordFailure(ip: string, email: string, now: number): void;
  /** Sucesso: zera a chave da conta (não penaliza o usuário legítimo). */
  resetAccount(ip: string, email: string): void;
}

const DEFAULT_PER_ACCOUNT: RateWindow = { max: 8, windowMs: 15 * 60_000 };
const DEFAULT_PER_IP: RateWindow = { max: 30, windowMs: 15 * 60_000 };

const accountKey = (ip: string, email: string) => `a:${ip}:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `i:${ip}`;

/** Cria um limiter com seu próprio store (testável; injete `now` nas chamadas). */
export function createLoginRateLimiter(
  perAccount: RateWindow = DEFAULT_PER_ACCOUNT,
  perIp: RateWindow = DEFAULT_PER_IP,
  store: Map<string, number[]> = new Map(),
): LoginRateLimiter {
  /** Conta falhas recentes na janela (podando as antigas). */
  function decide(key: string, now: number, cfg: RateWindow): RateDecision {
    const arr = store.get(key);
    if (!arr) return { blocked: false, retryAfterSec: 0 };
    const cutoff = now - cfg.windowMs;
    const recent = arr.filter((t) => t > cutoff);
    if (recent.length === 0) {
      store.delete(key);
      return { blocked: false, retryAfterSec: 0 };
    }
    if (recent.length !== arr.length) store.set(key, recent);
    if (recent.length >= cfg.max) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0]! + cfg.windowMs - now) / 1000));
      return { blocked: true, retryAfterSec };
    }
    return { blocked: false, retryAfterSec: 0 };
  }

  function push(key: string, now: number): void {
    const arr = store.get(key) ?? [];
    arr.push(now);
    store.set(key, arr);
  }

  return {
    check(ip, email, now) {
      const account = decide(accountKey(ip, email), now, perAccount);
      if (account.blocked) return account;
      return decide(ipKey(ip), now, perIp);
    },
    recordFailure(ip, email, now) {
      push(accountKey(ip, email), now);
      push(ipKey(ip), now);
    },
    resetAccount(ip, email) {
      store.delete(accountKey(ip, email));
    },
  };
}

// Singleton do app (resiliente ao HMR do Next — um store por processo).
const globalForRl = globalThis as unknown as { __nutrimedLoginRl?: LoginRateLimiter };
export const loginRateLimiter: LoginRateLimiter = (globalForRl.__nutrimedLoginRl ??=
  createLoginRateLimiter());

/** "2 min" / "45 s" — mensagem amigável do tempo de espera. */
export function formatRetry(sec: number): string {
  return sec >= 60 ? `${Math.ceil(sec / 60)} min` : `${sec} s`;
}
