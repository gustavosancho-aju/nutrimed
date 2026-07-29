'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  loadPatient,
  listBodyComposition,
  setPatientPhoto,
  startBodyProjection,
  completeBodyProjection,
  failBodyProjection,
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
  /** Projeção ABERTA — a imagem ainda está sendo gerada em segundo plano. */
  projectionId?: string;
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

  const modelVersion = projector.modelVersion ?? 'desconhecido';
  try {
    await setPatientPhoto(db, patientId, user.id, { base64: input.photoBase64, mimeType }, key, {
      action: 'patient-photo-set',
    });
    const projectionId = await startBodyProjection(db, patientId, {
      sourceWeightKg,
      targetWeightKg,
      modelVersion,
    });

    // A geração NÃO é aguardada: o gpt-image-2 leva ~142s e a página do médico
    // não pode ficar presa nisso (nem sobreviveria ao timeout do proxy). Isto
    // funciona porque o app roda como processo Node PERSISTENTE no Fly
    // (server.mjs) — em runtime serverless a promise seria morta na resposta.
    void gerarEmSegundoPlano(projectionId, input, projector);

    revalidatePath(`/patients/${patientId}/projecao`);
    return {
      projectionId,
      sourceWeightKg,
      targetWeightKg,
      modelVersion,
      message: 'Gerando a projeção — leva alguns minutos. A lista abaixo atualiza sozinha.',
    };
  } catch {
    return { error: 'Falha ao iniciar a projeção — tente novamente em alguns minutos.' };
  }
}

/**
 * Roda a geração fora do ciclo da requisição e fecha a linha (pronta ou falha).
 * NUNCA lança: uma exceção aqui viraria unhandled rejection e derrubaria o
 * processo do servidor inteiro — que atende as consultas ao vivo.
 */
async function gerarEmSegundoPlano(
  projectionId: string,
  input: BodyProjectionInput,
  projector: NonNullable<ReturnType<typeof createBodyProjector>>,
): Promise<void> {
  try {
    const resultado = await projector.project(input);
    const db = await getDb();
    await completeBodyProjection(
      db,
      projectionId,
      { base64: resultado.imageBase64, mimeType: resultado.mimeType },
      getEncryptionKey(),
    );
  } catch (err) {
    // 'input' e 'safety' já trazem frase acionável em pt-BR; o resto vira uma
    // mensagem genérica (detalhe de API não ajuda o médico a decidir o que fazer).
    const kind = (err as { kind?: string }).kind;
    const mensagem =
      kind === 'safety' || kind === 'input'
        ? (err as Error).message
        : 'Falha ao gerar a projeção — tente novamente em alguns minutos.';
    try {
      await failBodyProjection(await getDb(), projectionId, mensagem);
    } catch {
      // Banco fora do ar no momento da falha: a linha fica em 'processing' e a
      // UI a trata como travada pelo tempo decorrido. Nada mais a fazer aqui.
    }
  }
}

/**
 * Gate humano: libera a projeção para o Modo Apresentação.
 *
 * Quando nada muda, avisa em pt-BR pela query `?erro=` (mesmo padrão de
 * `addMeasurementAction`) em vez de lançar. Antes isto estourava uma exceção e
 * o médico via a tela de erro genérica do Next — foi o que aconteceu em
 * produção em 2026-07-29 às 00:16.
 */
export async function approveBodyProjectionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const projectionId = String(formData.get('projectionId') ?? '');
  const aprovada = await approveBodyProjection(await getDb(), projectionId, user.id);

  revalidatePath(`/patients/${patientId}/projecao`);
  revalidatePath(`/patients/${patientId}/apresentacao`);

  // Fora do try/await acima de propósito: `redirect` sinaliza por exceção
  // (NEXT_REDIRECT) e não pode ser engolido por um catch.
  if (!aprovada) {
    redirect(
      `/patients/${patientId}/projecao?erro=${encodeURIComponent(
        'Não foi possível aprovar essa projeção — ela pode ter sido descartada ou ainda estar sendo gerada.',
      )}`,
    );
  }
}

/**
 * Descarta a projeção (soft-delete — a linha permanece para a trilha).
 * IDEMPOTENTE: descartar o que já estava descartado não é erro, é o estado que
 * o médico queria. Clique duplo não vira tela de erro.
 */
export async function deleteBodyProjectionAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const patientId = String(formData.get('patientId') ?? '');
  const projectionId = String(formData.get('projectionId') ?? '');
  await softDeleteBodyProjection(await getDb(), projectionId, user.id);
  revalidatePath(`/patients/${patientId}/projecao`);
  revalidatePath(`/patients/${patientId}/apresentacao`);
}
