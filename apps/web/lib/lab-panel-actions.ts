'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  loadPatient,
  addLabExam,
  listLabExam,
  setLabDisplayPrefs,
  type LabAnalyte,
} from '@nutrimed/patients';
import { sanitizePanel } from '@nutrimed/lab-import';
import { parseReferenceRange } from '@nutrimed/lab-catalog';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';
import {
  toStoredAnalyte,
  planHistoryImport,
  existingHistoryKeys,
  resolveSlugCollisions,
} from './lab-panel';

/**
 * Server actions do painel laboratorial (E14).
 *
 * `saveLabPanelAction` é o GATE HUMANO da importação (ADR-012): a extração por
 * IA nunca grava — só grava o que o médico marcou e confirmou nesta tela. O
 * painel chega como JSON do formulário e é RE-SANEADO no servidor: a origem é a
 * sessão do próprio médico, mas o servidor não confia em payload de cliente.
 */

async function assertOwner(patientId: string) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const db = await getDb();
  const patient = await loadPatient(db, patientId, getEncryptionKey());
  if (!patient || patient.userId !== user.id) {
    throw new Error('Paciente não encontrado para este médico.');
  }
  return { user, db };
}

/** Data ISO `YYYY-MM-DD` ⇒ Date em UTC (medições não têm hora). */
function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "108,5" ou "108.5" ⇒ 108.5; vazio/inválido ⇒ null. */
function parseValue(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fail(patientId: string, msg: string): never {
  redirect(`/patients/${patientId}/import?erro=${encodeURIComponent(msg)}`);
}

/**
 * Grava o painel confirmado pelo médico. Duas gravações distintas:
 *
 * 1. a COLETA atual — uma medição com todos os analitos marcados;
 * 2. o HISTÓRICO impresso no próprio laudo ("Evolução do paciente"), opcional —
 *    uma medição por data anterior. É isso que faz a primeira importação já
 *    nascer com linha de tendência, em vez de um ponto solitário.
 *
 * Reimportar o mesmo laudo não duplica o histórico: pontos (data + exame) que
 * já existem são ignorados.
 */
export async function saveLabPanelAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { db } = await assertOwner(patientId);
  const key = getEncryptionKey();

  const panel = sanitizePanel(safeJson(formData.get('panel')));
  if (panel.analytes.length === 0) fail(patientId, 'Nenhum exame para salvar.');

  const dataColeta = String(formData.get('measuredAt') ?? '').trim();
  if (!ISO_DATE.test(dataColeta)) fail(patientId, 'Informe a data da coleta.');

  // Só os índices marcados entram (o médico desmarca o que não quer guardar).
  const marcados = new Set(formData.getAll('incluir').map((v) => String(v)));
  const modelVersion = String(formData.get('modelVersion') ?? '').trim() || undefined;

  /** Analitos confirmados + o histórico que cada um trouxe do laudo. */
  const confirmados: {
    stored: LabAnalyte;
    history?: readonly { measuredAt: string; value: number }[];
  }[] = [];

  panel.analytes.forEach((a, i) => {
    if (!marcados.has(String(i))) return;
    // O valor pode ter sido CORRIGIDO pelo médico; o campo vence a extração.
    const valor = parseValue(formData.get(`valor.${i}`)) ?? a.value;
    const stored = toStoredAnalyte({
      rawName: a.rawName,
      value: valor,
      unit: a.unit,
      range: parseReferenceRange(a.referenceText),
      refText: a.referenceText,
    });
    confirmados.push({ stored, ...(a.history ? { history: a.history } : {}) });
  });

  if (confirmados.length === 0) fail(patientId, 'Marque ao menos um exame para salvar.');

  // Um slug por laudo: linhas distintas que caem no mesmo exame (TTPA, RFG) são
  // separadas ANTES de gravar — senão viram pontos incomparáveis na mesma série.
  const analitos = resolveSlugCollisions(confirmados.map((c) => c.stored));

  const origin = { action: 'lab-panel-import', ...(modelVersion ? { modelVersion } : {}) };
  await addLabExam(
    db,
    patientId,
    { measuredAt: toUtcDate(dataColeta), values: { panel: analitos } },
    key,
    origin,
  );

  if (formData.get('importarHistorico') === 'on') {
    const planejadas = planHistoryImport({
      // `analitos` (pós-colisão) e `confirmados` têm a MESMA ordem — o histórico
      // precisa seguir o slug já resolvido, senão um ponto antigo do TTPA cairia
      // na série errada.
      analytes: analitos.map((stored, i) => ({
        slug: stored.slug,
        label: stored.label,
        ...(stored.unit ? { unit: stored.unit } : {}),
        ...(confirmados[i]!.history ? { history: confirmados[i]!.history } : {}),
      })),
      existing: existingHistoryKeys(await listLabExam(db, patientId, key)),
      collectionDate: dataColeta,
    });
    for (const p of planejadas) {
      await addLabExam(
        db,
        patientId,
        { measuredAt: toUtcDate(p.measuredAt), values: { panel: p.analytes } },
        key,
        { action: 'lab-panel-import-historico', modelVersion: 'laudo-evolucao' },
      );
    }
  }

  revalidatePath(`/patients/${patientId}/dashboard`);
  redirect(`/patients/${patientId}/dashboard?aba=exames`);
}

/** JSON do formulário — payload inválido vira null (o chamador reclama). */
function safeJson(raw: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(raw ?? ''));
  } catch {
    return null;
  }
}

/**
 * Salva quais exames vão para a tela de apresentação do paciente, na ordem em
 * que o médico os marcou. Nenhum marcado ⇒ a apresentação não mostra exames.
 */
export async function setLabDisplayAction(formData: FormData): Promise<void> {
  const patientId = String(formData.get('patientId') ?? '');
  const { db } = await assertOwner(patientId);

  const escolhidos = formData.getAll('apresentar').map((v) => String(v).trim());
  await setLabDisplayPrefs(db, patientId, escolhidos, getEncryptionKey());

  revalidatePath(`/patients/${patientId}/dashboard`);
  revalidatePath(`/patients/${patientId}/apresentacao`);
  redirect(`/patients/${patientId}/dashboard?aba=exames`);
}
