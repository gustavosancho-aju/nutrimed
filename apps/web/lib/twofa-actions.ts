'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { generateTotpSecret, verifyTotp } from '@nutrimed/auth';
import { encryptField, decryptField } from '@nutrimed/crypto';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';

/**
 * Cadastro/gestão da verificação em duas etapas (TOTP) do médico. O secret é
 * cifrado (NFR9). Opcional: só passa a valer no login quando `totp_enabled=true`
 * (confirmado por um código válido). Segue o padrão redirect+banner (?erro/?ok).
 */

/** Gera um secret novo (ainda desativado) e mostra o setup para o app. */
export async function generateTotpSecretAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = await getDb();
  const secret = generateTotpSecret();
  await db.query('UPDATE app_user SET totp_secret_enc = $2, totp_enabled = false WHERE id = $1', [
    user.id,
    encryptField(secret, getEncryptionKey()),
  ]);
  revalidatePath('/seguranca');
  redirect('/seguranca');
}

/** Confirma o setup com um código válido ⇒ ativa o 2FA. */
export async function confirmTotpAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const code = String(formData.get('totp') ?? '').trim();
  const db = await getDb();
  const res = await db.query<{ totp_secret_enc: string | null }>(
    'SELECT totp_secret_enc FROM app_user WHERE id = $1',
    [user.id],
  );
  const enc = res.rows[0]?.totp_secret_enc ?? null;
  const secret = enc ? decryptField(enc, getEncryptionKey()) : null;
  if (!secret || !verifyTotp(secret, code, Date.now())) {
    redirect('/seguranca?erro=' + encodeURIComponent('Código inválido — confira no app e tente de novo.'));
  }
  await db.query('UPDATE app_user SET totp_enabled = true WHERE id = $1', [user.id]);
  revalidatePath('/seguranca');
  redirect('/seguranca?ok=enabled');
}

/** Desativa o 2FA — exige um código atual válido (evita desligar sem o fator). */
export async function disableTotpAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const code = String(formData.get('totp') ?? '').trim();
  const db = await getDb();
  const res = await db.query<{ totp_secret_enc: string | null; totp_enabled: boolean }>(
    'SELECT totp_secret_enc, totp_enabled FROM app_user WHERE id = $1',
    [user.id],
  );
  const row = res.rows[0];
  const secret = row?.totp_secret_enc ? decryptField(row.totp_secret_enc, getEncryptionKey()) : null;
  if (!row?.totp_enabled || !secret || !verifyTotp(secret, code, Date.now())) {
    redirect('/seguranca?erro=' + encodeURIComponent('Código inválido — não foi possível desativar.'));
  }
  await db.query('UPDATE app_user SET totp_enabled = false, totp_secret_enc = null WHERE id = $1', [
    user.id,
  ]);
  revalidatePath('/seguranca');
  redirect('/seguranca?ok=disabled');
}
