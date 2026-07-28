'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  loadPatient,
  listBodyComposition,
  setPatientPhoto,
  addBodyProjection,
  approveBodyProjection,
  softDeleteBodyProjection,
} from '@nutrimed/patients';
import {
  createBodyProjector,
  validateProjectionInput,
  sniffImageMime,
  ALLOWED_PHOTO_MIME_TYPES,
  type BodyProjectionInput,
} from '@nutrimed/body-projection';
import { getDb } from './db';
import { getCurrentUser } from './auth';
import { getEncryptionKey } from './crypto-key';
import { parseDecimal } from './dashboard';

/**
 * Projeção corporal por foto (apoio visual/motivacional). Fluxo em 2 passos,
 * como a importação de laudo: gerar NÃO mostra nada ao paciente — a imagem
 * nasce pendente e só entra no Modo Apresentação depois que o médico aprova.
 *
 * Custo: não há telemetria própria aqui de propósito. Cada geração já grava uma
 * linha de auditoria ('body-projection-generate' + modelVersion), que é a
 * contagem exata e consultável do que foi gasto; o teto de gasto de verdade é o
 * limite por chave no console do provedor (lição do vazamento de 2026-07-24).
 */

/** Teto do arquivo cru — o cliente já reduz a foto antes de enviar. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface ProjectionState {
  /** Projeção recém-gerada, aguardando o olhar do médico. */
  projectionId?: string;
  /** Imagem gerada como data URL — trafega no HTML autenticado, nunca por URL. */
  imageDataUrl?: string;
  /** Foto enviada, para o comparativo antes/depois na tela. */
  photoDataUrl?: string;
  sourceWeightKg?: number;
  targetWeightKg?: number;
  modelVersion?: string;
  message?: string;
  error?: string;
}

/**
 * Gera a projeção: foto + peso atual + peso desejado → imagem. Compatível com
 * `useActionState`. Nunca lança — qualquer falha vira mensagem em pt-BR
 * (degradação graciosa NFR13: o médico continua com o simulador SVG).
 */
export async function generateBodyProjectionAction(
  _prev: ProjectionState,
  formData: FormData,
): Promise<ProjectionState> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const db = await getDb();
  const key = getEncryptionKey();
  const patient = await loadPatient(db, patientId, key);
  if (!patient || patient.userId !== user.id) return { error: 'Paciente não encontrado.' };

  // Consentimento do paciente para usar a foto: exigido a CADA geração e
  // registrado na auditoria. Foto de rosto é dado pessoal sensível (LGPD).
  if (formData.get('consent') !== 'on') {
    return { error: 'Confirme o consentimento do paciente para usar a foto.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Selecione uma foto do paciente.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Arquivo muito grande (máx. 10 MB).' };

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) {
    return { error: `Formato não suportado — use ${ALLOWED_PHOTO_MIME_TYPES.join(', ')}.` };
  }

  // Peso atual: o que o médico digitou; em branco, a última medição registrada.
  const ultima = (await listBodyComposition(db, patientId, key)).at(-1);
  const sourceWeightKg = parseDecimal(formData.get('sourceWeightKg')) ?? ultima?.values.peso;
  const targetWeightKg = parseDecimal(formData.get('targetWeightKg'));
  if (sourceWeightKg === undefined || targetWeightKg === undefined) {
    return { error: 'Informe o peso atual e o peso desejado.' };
  }

  const input: BodyProjectionInput = {
    photoBase64: bytes.toString('base64'),
    mimeType,
    currentWeightKg: sourceWeightKg,
    targetWeightKg,
    ...(patient.heightCm ? { heightCm: patient.heightCm } : {}),
  };
  const invalido = validateProjectionInput(input);
  if (invalido) return { error: invalido };

  const projector = createBodyProjector();
  if (!projector) {
    return {
      error:
        'Projeção por imagem indisponível no servidor — use o simulador de silhueta no Modo Apresentação.',
    };
  }

  try {
    const resultado = await projector.project(input);

    await setPatientPhoto(db, patientId, user.id, { base64: input.photoBase64, mimeType }, key, {
      action: 'patient-photo-set',
    });
    const projectionId = await addBodyProjection(
      db,
      patientId,
      {
        sourceWeightKg,
        targetWeightKg,
        image: { base64: resultado.imageBase64, mimeType: resultado.mimeType },
        modelVersion: resultado.modelVersion,
      },
      key,
    );

    revalidatePath(`/patients/${patientId}/dashboard`);
    return {
      projectionId,
      imageDataUrl: `data:${resultado.mimeType};base64,${resultado.imageBase64}`,
      photoDataUrl: `data:${mimeType};base64,${input.photoBase64}`,
      sourceWeightKg,
      targetWeightKg,
      modelVersion: resultado.modelVersion,
      message: 'Imagem ilustrativa gerada por IA — confira antes de mostrar ao paciente.',
    };
  } catch (err) {
    // As mensagens de 'input' e 'safety' já vêm em pt-BR acionáveis; o resto
    // vira uma frase genérica (detalhe de API não ajuda o médico).
    const kind = (err as { kind?: string }).kind;
    if (kind === 'safety' || kind === 'input') return { error: (err as Error).message };
    return {
      error: 'Falha ao gerar a projeção — tente novamente em alguns minutos.',
    };
  }
}

/** Gate humano: libera a projeção para o Modo Apresentação. */
export async function approveBodyProjectionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const projectionId = String(formData.get('projectionId') ?? '');
  await approveBodyProjection(await getDb(), projectionId, user.id);
  revalidatePath(`/patients/${patientId}/dashboard`);
  revalidatePath(`/patients/${patientId}/apresentacao`);
}

/** Descarta a projeção (soft-delete — a linha permanece para a trilha). */
export async function deleteBodyProjectionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const projectionId = String(formData.get('projectionId') ?? '');
  await softDeleteBodyProjection(await getDb(), projectionId, user.id);
  revalidatePath(`/patients/${patientId}/dashboard`);
  revalidatePath(`/patients/${patientId}/apresentacao`);
}
