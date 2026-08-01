'use server';

import { revalidatePath } from 'next/cache';
import {
  extractConsultationForm,
  saveConsultationForm,
  applyKnownFields,
  sanitizeForm,
  type ConsultationForm,
} from '@nutrimed/consultation-form';
import { loadPatient, computeAge, listBodyComposition } from '@nutrimed/patients';
import { AnthropicLlmProvider } from '@nutrimed/llm-anthropic';
import { KimiLlmProvider } from '@nutrimed/llm-kimi';
import { FakeLlmProvider, FakeTextCompleter, type ILlmProvider } from '@nutrimed/providers';
import { getCurrentUser } from './auth';
import { getDb } from './db';
import { getEncryptionKey } from './crypto-key';
import { getNoteInputs } from './board-runtime';
import { assertConsultationOwner, consultationBelongsTo } from './consultation-owner';
import { toActionResult, type ActionResult } from './action-result';

/**
 * Server actions da FICHA DE CONSULTA (anamnese estruturada de nutrologia).
 *
 * Mesma divisão de trabalho do relatório nutricional (E13): a IA cuida do que
 * só existe na CONVERSA (queixas, hábitos, história familiar, conduta dita) e o
 * CÓDIGO cuida do que já está estruturado no banco (identificação e
 * antropometria). O que o sistema mediu nunca é reescrito pelo modelo.
 */

function buildFormLlm(): ILlmProvider {
  // Mesma escolha de provedor da nota clínica: Kimi assume os documentos longos
  // quando há key, Claude é o fallback (ver note-actions.ts).
  if (process.env.KIMI_API_KEY) {
    return new KimiLlmProvider({
      apiKey: process.env.KIMI_API_KEY,
      personaId: 'aurelio',
      longForm: true,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider({ apiKey: process.env.ANTHROPIC_API_KEY, personaId: 'aurelio' });
  }
  const fake = new FakeLlmProvider('aurelio', 'sintese');
  const texts = new FakeTextCompleter([
    JSON.stringify({
      objetivoPrincipal: { marcados: ['emagrecimento'], motivo: '(rascunho fake — dev sem API key)' },
      conduta: { nutricao: '(fake)' },
    }),
  ]);
  return { complete: (req) => fake.complete(req), completeText: (req) => texts.completeText(req) };
}

/** Data de hoje no formato dd/mm/aaaa — o cabeçalho da ficha em papel. */
function todayBr(): string {
  return new Date().toLocaleDateString('pt-BR');
}

/**
 * Gera o rascunho da ficha a partir da transcrição (revisada, quando houver) e
 * dos dados do paciente vinculado. Compatível com useActionState — nunca lança.
 *
 * Paciente não vinculado NÃO é erro: a ficha sai só com o que a conversa deu, e
 * o médico completa a identificação na tela. Recusar geraria atrito exatamente
 * na primeira consulta, quando o cadastro ainda não existe.
 */
export async function generateConsultationFormAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, code: 'unauthenticated' };
    const consultationId = String(formData.get('consultationId') ?? '');
    if (!consultationId) return { ok: false, code: 'invalid-input' };
    const db = await getDb();
    if (!(await consultationBelongsTo(db, consultationId, user.id))) {
      return { ok: false, code: 'not-found' };
    }

    const inputs = await getNoteInputs(consultationId);
    if (!inputs || inputs.finals.length === 0) return { ok: false, code: 'no-transcript' };

    const extracted = await extractConsultationForm(buildFormLlm(), inputs.finals);

    const key = getEncryptionKey();
    const linked = await db.query<{ patient_id: string | null }>(
      'SELECT patient_id FROM consultation WHERE id = $1',
      [consultationId],
    );
    const patientId = linked.rows[0]?.patient_id ?? null;

    let form = extracted.form;
    if (patientId) {
      const patient = await loadPatient(db, patientId, key);
      const latest = (await listBodyComposition(db, patientId, key)).at(-1);
      const pesoKg = latest?.values.peso ?? null;
      const alturaCm = patient?.heightCm ?? null;
      form = applyKnownFields(form, {
        nome: patient?.name ?? null,
        idade: computeAge(patient?.birthDate, new Date()),
        profissao: patient?.profession ?? null,
        telefone: patient?.phone ?? null,
        data: todayBr(),
        alturaCm,
        pesoKg,
        // IMC medido pela bioimpedância vence; sem ele, deriva de peso+altura —
        // o valor da balança do dia é mais fiel que o número dito na conversa.
        imc:
          latest?.values.imc ??
          (pesoKg && alturaCm ? pesoKg / (alturaCm / 100) ** 2 : null),
      });
    } else {
      form = applyKnownFields(form, { data: todayBr() });
    }

    await saveConsultationForm(db, consultationId, form, key, {
      action: 'generate',
      modelVersion: extracted.modelVersion ?? 'unknown',
    });
    revalidatePath(`/consultations/${consultationId}`);
    revalidatePath(`/consultations/${consultationId}/ficha`);
    return { ok: true };
  } catch (err) {
    console.error('[ficha] generateConsultationFormAction falhou:', err);
    return toActionResult(err);
  }
}

/**
 * Reconstrói a ficha a partir do FormData da tela. Checkbox só chega no
 * FormData quando MARCADO — o que o médico desmarcou some, e é justamente por
 * isso que a ficha é regravada INTEIRA a cada save: um merge parcial deixaria
 * de volta um achado que ele acabou de tirar.
 */
function formFromFormData(data: FormData): ConsultationForm {
  const text = (name: string): string => String(data.get(name) ?? '');
  const list = (name: string): string[] => data.getAll(name).map(String);
  return sanitizeForm({
    identificacao: {
      nome: text('nome'),
      idade: text('idade'),
      sexo: text('sexo'),
      profissao: text('profissao'),
      telefone: text('telefone'),
      data: text('data'),
    },
    objetivoPrincipal: {
      marcados: list('objetivoPrincipal'),
      outro: text('objetivoOutro'),
      motivo: text('motivo'),
    },
    antropometria: {
      pesoAtual: text('pesoAtual'),
      pesoMaximo: text('pesoMaximo'),
      pesoMinimoAdulto: text('pesoMinimoAdulto'),
      altura: text('altura'),
      imc: text('imc'),
    },
    doencasAssociadas: { marcados: list('doencas'), observacoes: text('doencasObs') },
    historicoFamiliar: { marcados: list('historico'), observacoes: text('historicoObs') },
    alimentacao: { marcados: list('alimentacao'), observacoes: text('alimentacaoObs') },
    exercicio: {
      sedentario: data.get('sedentario') !== null,
      atividade: text('atividade'),
      frequenciaSemanal: text('frequenciaSemanal'),
      duracao: text('duracao'),
      intensidade: text('intensidade'),
    },
    sono: { horasPorNoite: text('horasPorNoite'), marcados: list('sono') },
    medicacoes: {
      usoContinuo: text('usoContinuo'),
      suplementos: text('suplementos'),
      hormoniosPrevios: text('hormoniosPrevios'),
      alergias: text('alergias'),
    },
    exameFisico: {
      pa: text('pa'),
      fc: text('fc'),
      marcados: list('exameFisico'),
      observacoes: text('exameFisicoObs'),
    },
    estratificacao: { prevent: text('prevent'), riscoCardiometabolico: text('risco') },
    objetivosTerapeuticos: { marcados: list('objetivosTerapeuticos'), metas: text('metasTerapeuticas') },
    conduta: {
      nutricao: text('condutaNutricao'),
      exercicio: text('condutaExercicio'),
      medicacoes: text('condutaMedicacoes'),
      suplementacao: text('condutaSuplementacao'),
      solicitacaoExames: text('condutaExames'),
      metas: text('condutaMetas'),
    },
    retorno: { data: text('retornoData'), observacoes: text('retornoObs') },
  });
}

/** Salva a ficha revisada pelo médico — auditada como human-edit. */
export async function saveConsultationFormAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado.');
  const consultationId = String(formData.get('consultationId') ?? '');
  if (!consultationId) throw new Error('consultationId ausente.');
  await assertConsultationOwner(await getDb(), consultationId, user.id);

  await saveConsultationForm(
    await getDb(),
    consultationId,
    formFromFormData(formData),
    getEncryptionKey(),
    { action: 'edit' },
  );
  revalidatePath(`/consultations/${consultationId}`);
  revalidatePath(`/consultations/${consultationId}/ficha`);
}
