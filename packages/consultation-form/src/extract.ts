import type { ILlmProvider } from '@nutrimed/providers';
import {
  ALIMENTACAO,
  DOENCAS_ASSOCIADAS,
  EXAME_FISICO,
  HISTORICO_FAMILIAR,
  OBJETIVOS_TERAPEUTICOS,
  OBJETIVO_PRINCIPAL,
  RISCO_CARDIOMETABOLICO,
  SONO,
  sanitizeForm,
  type ConsultationForm,
  type FormOption,
} from './schema';

/**
 * Preenchimento do RASCUNHO da ficha a partir da transcrição da consulta.
 *
 * "IA assiste, médico decide": o que sai daqui é rascunho e nada mais — a ficha
 * só é gravada depois que o médico revisa (mesmo gate da nota clínica e do
 * relatório E13). Por isso a regra dura do prompt é o SILÊNCIO: campo não
 * mencionado fica em branco. Ficha clínica preenchida por dedução ("obeso, logo
 * marca esteatose") é pior que ficha vazia — a vazia o médico completa, a
 * inventada ele precisa primeiro descobrir que está errada.
 */

function listOptions(group: readonly FormOption[]): string {
  return group.map((o) => `"${o.value}" (${o.label})`).join(', ');
}

const SYSTEM =
  'Você preenche uma FICHA DE CONSULTA de nutrologia a partir da transcrição de uma consulta médica, ' +
  'em português do Brasil. Responda APENAS com um objeto JSON — sem preâmbulo, sem comentários, sem cercas de código.\n\n' +
  'REGRA MAIS IMPORTANTE: só preencha o que foi EXPLICITAMENTE dito na consulta. ' +
  'Campo não mencionado fica null; lista sem menção fica []. ' +
  'NÃO deduza, NÃO infira a partir de outros achados e NÃO complete com o que seria clinicamente provável. ' +
  'Uma ficha incompleta é esperada e correta; uma ficha com achado inventado é um erro grave de prontuário.\n\n' +
  'Nos campos de texto livre, escreva o que o paciente/médico disse, de forma sucinta e factual. ' +
  'Nos campos de conduta, registre apenas condutas que o médico de fato indicou na consulta.\n\n' +
  'Estrutura EXATA do JSON (use estas chaves; nos campos "marcados" use apenas os valores listados):\n' +
  `{
  "identificacao": { "nome": null, "idade": null, "sexo": null, "profissao": null, "telefone": null },
  "objetivoPrincipal": { "marcados": [${listOptions(OBJETIVO_PRINCIPAL)}], "outro": null, "motivo": "o motivo que levou o paciente à consulta" },
  "antropometria": { "pesoAtual": null, "pesoMaximo": "maior peso que já teve", "pesoMinimoAdulto": "menor peso na vida adulta", "altura": null, "imc": null },
  "doencasAssociadas": { "marcados": [${listOptions(DOENCAS_ASSOCIADAS)}], "observacoes": null },
  "historicoFamiliar": { "marcados": [${listOptions(HISTORICO_FAMILIAR)}], "observacoes": null },
  "alimentacao": { "marcados": [${listOptions(ALIMENTACAO)}], "observacoes": null },
  "exercicio": { "sedentario": false, "atividade": null, "frequenciaSemanal": null, "duracao": null, "intensidade": null },
  "sono": { "horasPorNoite": null, "marcados": [${listOptions(SONO)}] },
  "medicacoes": { "usoContinuo": null, "suplementos": null, "hormoniosPrevios": "hormônios ou anabolizantes usados no passado", "alergias": null },
  "exameFisico": { "pa": "pressão arterial", "fc": "frequência cardíaca", "marcados": [${listOptions(EXAME_FISICO)}], "observacoes": null },
  "estratificacao": { "prevent": "escore PREVENT, se calculado na consulta", "riscoCardiometabolico": "um de: ${RISCO_CARDIOMETABOLICO.map((o) => o.value).join(', ')} — apenas se o médico classificar" },
  "objetivosTerapeuticos": { "marcados": [${listOptions(OBJETIVOS_TERAPEUTICOS)}], "metas": null },
  "conduta": { "nutricao": null, "exercicio": null, "medicacoes": null, "suplementacao": null, "solicitacaoExames": null, "metas": null },
  "retorno": { "data": null, "observacoes": null }
}`;

/**
 * Remove as cercas ```json que os modelos insistem em colocar mesmo instruídos
 * a não colocar, e recorta o primeiro objeto JSON da resposta.
 */
function extractJsonObject(text: string): string {
  const withoutFence = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return withoutFence.trim();
  return withoutFence.slice(start, end + 1);
}

/**
 * Gera o rascunho da ficha (FR17 — mesmo caminho da nota clínica: `completeText`,
 * texto livre, porque o contrato JSON de contribuição do board trunca no
 * maxTokens e derruba o parse).
 *
 * Retorna a ficha JÁ sanitizada: opção fora do catálogo é descartada e campo
 * ausente vira branco, então o que chega à tela é sempre desenhável.
 */
export async function extractConsultationForm(
  llm: ILlmProvider,
  transcriptFinals: readonly string[],
): Promise<{ form: ConsultationForm; modelVersion?: string }> {
  if (!llm.completeText) {
    throw new Error(
      'Provider de LLM sem suporte a texto livre (completeText) — necessário para preencher a ficha.',
    );
  }
  const transcript = transcriptFinals.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const result = await llm.completeText({
    system: SYSTEM,
    prompt: `Transcrição da consulta:\n${transcript}`,
    maxTokens: 4000,
  });
  const raw = result.text?.trim();
  if (!raw) {
    throw new Error('O modelo não gerou conteúdo para a ficha — tente novamente.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error('O modelo devolveu uma ficha em formato inválido — tente novamente.');
  }
  return { form: sanitizeForm(parsed), modelVersion: result.modelVersion };
}
