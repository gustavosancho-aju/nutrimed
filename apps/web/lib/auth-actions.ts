'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPassword, createSession, deleteSession } from '@nutrimed/auth';
import { getDb } from './db';
import { SESSION_COOKIE } from './auth';
import { loginRateLimiter, formatRetry } from './login-rate-limit';

export interface LoginState {
  error?: string;
}

/** IP real do cliente atrás do proxy do Fly (fly-client-ip) — fallback XFF. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get('fly-client-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    return { error: 'Informe usuário e senha.' };
  }

  // Anti brute-force: bloqueia ANTES de checar a senha se a conta ou o IP
  // estourou a janela de falhas. Não revela se o usuário existe.
  const ip = await clientIp();
  const now = Date.now();
  const gate = loginRateLimiter.check(ip, email, now);
  if (gate.blocked) {
    return { error: `Muitas tentativas. Tente novamente em ${formatRetry(gate.retryAfterSec)}.` };
  }

  const db = await getDb();
  const res = await db.query<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM app_user WHERE email = $1',
    [email],
  );
  const user = res.rows[0];
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    loginRateLimiter.recordFailure(ip, email, now);
    return { error: 'Credenciais inválidas.' };
  }

  loginRateLimiter.resetAccount(ip, email);
  const { token, expiresAt } = await createSession(db, user.id);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
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
