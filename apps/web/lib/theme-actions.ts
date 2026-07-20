'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { THEMES, type Theme } from './theme';

/**
 * Troca o tema visual do médico (briefing do piloto 2026-07-19: "o cliente
 * poder mudar essas cores"). Não é dado sensível — sem cifra/auditoria, só
 * uma preferência de UI persistida por usuário.
 */
export async function setThemeAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const theme = String(formData.get('theme') ?? '');
  if (!THEMES.includes(theme as Theme)) redirect('/seguranca');

  const db = await getDb();
  await db.query('UPDATE app_user SET theme = $2 WHERE id = $1', [user.id, theme]);
  revalidatePath('/', 'layout'); // data-theme vive no <html> do layout raiz
  redirect('/seguranca');
}
