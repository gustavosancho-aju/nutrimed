'use server';

import { redirect } from 'next/navigation';
import { loadPatient } from '@nutrimed/patients';
import { createLabExtractor, type LaudoKind, type ExtractedLaudo } from '@nutrimed/lab-import';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ImportState {
  kind?: LaudoKind;
  draft?: ExtractedLaudo;
  modelVersion?: string;
  message?: string;
  error?: string;
}

/**
 * Extrai um rascunho do laudo (ADR-012) — NÃO persiste nada. O resultado
 * pré-preenche o form de confirmação; a gravação só ocorre quando o médico
 * confirma (gate humano obrigatório, em `addMeasurementAction`). Compatível com
 * `useActionState`. Degradação graciosa (NFR13): qualquer falha vira rascunho
 * vazio + mensagem, para entrada manual.
 */
export async function extractLaudoAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const kind: LaudoKind = formData.get('kind') === 'lab' ? 'lab' : 'body';

  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, patientId, key);
  if (!patient || patient.userId !== user.id) return { kind, error: 'Paciente não encontrado.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { kind, error: 'Selecione um arquivo PDF.' };
  if (file.size > MAX_BYTES) return { kind, error: 'PDF muito grande (máx. 10 MB).' };

  const extractor = createLabExtractor();
  if (!extractor) {
    return {
      kind,
      draft: { kind, values: {} },
      message: 'Extração automática indisponível — preencha os valores manualmente.',
    };
  }

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const draft = await extractor.extract({ base64, filename: file.name }, kind);
    const found = Object.keys(draft.values).length;
    return {
      kind: draft.kind,
      draft,
      modelVersion: extractor.modelVersion,
      message: found
        ? draft.notes ?? 'Confira os valores extraídos antes de salvar.'
        : 'Não foi possível ler valores do PDF — preencha manualmente.',
    };
  } catch {
    return {
      kind,
      draft: { kind, values: {} },
      message: 'Falha ao ler o PDF — preencha os valores manualmente.',
    };
  }
}
