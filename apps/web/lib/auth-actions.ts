'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPassword, verifyTotp, createSession, deleteSession } from '@nutrimed/auth';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { SESSION_COOKIE } from './auth';
import { loginRateLimiter, formatRetry } from './login-rate-limit';

export interface LoginState {
  error?: string;
  /** true ⇒ senha OK, mas o 2FA exige o código TOTP na próxima etapa. */
  needsTotp?: boolean;
}

const PENDING_2FA_COOKIE = 'nutrimed_2fa';
const PENDING_TTL_MS = 5 * 60_000;

/** IP real do cliente atrás do proxy do Fly (fly-client-ip) — fallback XFF. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('fly-client-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Cookie pendente (entre senha e TOTP): {userId, exp} cifrado — não forjável. */
function writePending(userId: string, now: number): string {
  return encryptField(JSON.stringify({ userId, exp: now + PENDING_TTL_MS }), getEncryptionKey());
}
function readPending(value: string | undefined, now: number): string | null {
  if (!value) return null;
  try {
    const p = JSON.parse(decryptField(value, getEncryptionKey())) as { userId?: string; exp?: number };
    if (!p.userId || !p.exp || p.exp < now) return null;
    return p.userId;
  } catch {
    return null;
  }
}

/** Cria a sessão e grava o cookie httpOnly/secure. */
async function startSession(userId: string): Promise<void> {
  const db = await getDb();
  const { token, expiresAt } = await createSession(db, userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const db = await getDb();
  const ip = await clientIp();
  const now = Date.now();
  const totp = String(formData.get('totp') ?? '').trim();

  // ── Etapa 2: código TOTP (a identidade vem do cookie pendente cifrado) ──
  if (totp) {
    const jar = await cookies();
    const userId = readPending(jar.get(PENDING_2FA_COOKIE)?.value, now);
    if (!userId) return { error: 'Verificação expirada — faça login novamente.' };

    // Rate-limit do código (6 dígitos são força-brutáveis sem isso).
    const gate = loginRateLimiter.check(ip, `totp:${userId}`, now);
    if (gate.blocked) {
      return { error: `Muitas tentativas. Tente em ${formatRetry(gate.retryAfterSec)}.`, needsTotp: true };
    }
    const res = await db.query<{ totp_secret_enc: string | null; totp_enabled: boolean }>(
      'SELECT totp_secret_enc, totp_enabled FROM app_user WHERE id = $1',
      [userId],
    );
    const row = res.rows[0];
    const secret = row?.totp_secret_enc ? decryptField(row.totp_secret_enc, getEncryptionKey()) : null;
    if (!row?.totp_enabled || !secret || !verifyTotp(secret, totp, now)) {
      loginRateLimiter.recordFailure(ip, `totp:${userId}`, now);
      return { error: 'Código inválido.', needsTotp: true };
    }
    loginRateLimiter.resetAccount(ip, `totp:${userId}`);
    jar.delete(PENDING_2FA_COOKIE);
    await startSession(userId);
    redirect('/');
  }

  // ── Etapa 1: usuário + senha ──
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Informe usuário e senha.' };

  const gate = loginRateLimiter.check(ip, email, now);
  if (gate.blocked) {
    return { error: `Muitas tentativas. Tente novamente em ${formatRetry(gate.retryAfterSec)}.` };
  }
  const res = await db.query<{ id: string; password_hash: string | null; totp_enabled: boolean }>(
    'SELECT id, password_hash, totp_enabled FROM app_user WHERE email = $1',
    [email],
  );
  const user = res.rows[0];
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    loginRateLimiter.recordFailure(ip, email, now);
    return { error: 'Credenciais inválidas.' };
  }
  loginRateLimiter.resetAccount(ip, email);

  if (user.totp_enabled) {
    // 2FA ativo: guarda o pendente cifrado e pede o código (não cria sessão ainda).
    (await cookies()).set(PENDING_2FA_COOKIE, writePending(user.id, now), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: PENDING_TTL_MS / 1000,
      path: '/',
    });
    return { needsTotp: true };
  }

  await startSession(user.id);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await deleteSession(db, token);
    jar.delete(SESSION_COOKIE);
  }
  redirect('/login');
}
