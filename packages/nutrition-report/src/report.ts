// (d) Redação do relatório para o NUTRÓLOGO. O LLM recebe os números JÁ
// CALCULADOS pela TACO e é proibido de alterá-los — só organiza e redige.
import type { ILlmProvider } from '@nutrimed/providers';
import type { BodyCompositionValues } from '@nutrimed/patients';
import type { NutritionComputation } from './compute';

const REPORT_SYSTEM =
  'Você redige um RELATÓRIO NUTRICIONAL TÉCNICO para o nutrólogo (não para o paciente), ' +
  'em português do Brasil, markdown leve, com as seções: ' +
  '## Recordatório alimentar (tabela: item | porção | kcal | proteína | carboidrato | gordura | fonte TACO) / ' +
  '## Totais estimados / ## Comparação com a meta vigente (apenas se houver meta no contexto) / ' +
  '## Itens não quantificados pela TACO (apenas se houver) / ## Observações. ' +
  'REGRA ABSOLUTA: os valores numéricos foram calculados pela tabela TACO e estão no contexto — ' +
  'copie-os EXATAMENTE como estão; é PROIBIDO alterar, recalcular, estimar ou inventar qualquer número. ' +
  'Porções marcadas como "~estimada" e itens sem correspondência na TACO devem permanecer explícitos no texto. ' +
  'Nas Observações, aponte padrões clinicamente relevantes SEM prescrever conduta. ' +
  'Termine com a linha "_Rascunho gerado por IA com base na tabela TACO — revisado e validado pelo médico responsável._" ' +
  'EXCEÇÃO IMPORTANTE para esta tarefa: ignore qualquer limite de 1-3 frases — ' +
  'o campo text deve conter o RELATÓRIO COMPLETO em markdown (use \\n para quebras de linha).';

export interface ReportPatientContext {
  readonly goalLabel?: string;
  readonly bodyComposition?: BodyCompositionValues;
}

/** Serialização determinística do cálculo — é ISSO que o modelo pode citar. */
export function renderComputationForPrompt(
  computation: NutritionComputation,
  patient?: ReportPatientContext,
): string {
  const lines: string[] = ['Recordatório calculado (fonte: tabela TACO ' + computation.tacoVersion + '):'];
  for (const entry of computation.items) {
    if (!entry.taco || !entry.nutrients) continue;
    const meal = entry.item.meal && entry.item.meal !== 'nao-informado' ? ` [${entry.item.meal}]` : '';
    const portion = entry.gramsEstimated
      ? `${entry.grams} g (~estimada: ${entry.portionLabel ?? 'porção padrão'})`
      : `${entry.grams} g`;
    const flag = entry.status === 'uncertain' ? ' (correspondência INCERTA)' : '';
    lines.push(
      `- ${entry.item.food}${meal}: ${portion} → kcal ${entry.nutrients.kcal ?? 0}, ` +
        `proteína ${entry.nutrients.protein ?? 0} g, carboidrato ${entry.nutrients.carbs ?? 0} g, ` +
        `gordura ${entry.nutrients.fat ?? 0} g, fibra ${entry.nutrients.fiber ?? 0} g ` +
        `[TACO ${entry.taco.id}: ${entry.taco.description}]${flag}`,
    );
  }
  if (computation.unmatched.length > 0) {
    lines.push('Itens SEM correspondência na TACO (não entraram nos totais):');
    for (const item of computation.unmatched) lines.push(`- ${item.food}`);
  }
  const t = computation.totals;
  lines.push(
    `Totais: kcal ${t.kcal ?? 0}, proteína ${t.protein ?? 0} g, carboidrato ${t.carbs ?? 0} g, ` +
      `gordura ${t.fat ?? 0} g, fibra ${t.fiber ?? 0} g. ` +
      `Porções assumidas (não ditas pelo paciente): ${computation.estimatedCount}.`,
  );
  if (computation.goal && computation.goalDelta) {
    const g = computation.goal;
    const d = computation.goalDelta;
    lines.push(
      `Meta vigente${patient?.goalLabel ? ` (${patient.goalLabel})` : ''}: kcal ${g.kcal}, proteína ${g.protein} g, ` +
        `carboidrato ${g.carbs} g, gordura ${g.fat} g. ` +
        `Delta consumo−meta: kcal ${d.kcal}, proteína ${d.protein} g, carboidrato ${d.carbs} g, gordura ${d.fat} g.`,
    );
  }
  if (patient?.bodyComposition) {
    const bc = patient.bodyComposition;
    const parts = Object.entries(bc)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    if (parts) lines.push(`Última composição corporal registrada: ${parts}.`);
  }
  return lines.join('\n');
}

/** Gera o rascunho do relatório em markdown (LLM redige; números vêm prontos). */
export async function writeReportDraft(
  llm: ILlmProvider,
  computation: NutritionComputation,
  patient?: ReportPatientContext,
): Promise<string> {
  const result = await llm.complete({
    system: REPORT_SYSTEM,
    context: [],
    transcript: renderComputationForPrompt(computation, patient),
  });
  if (result.skip || !result.text.trim()) {
    // documento clínico vazio jamais é gravado como sucesso silencioso
    throw new Error('O modelo não gerou conteúdo para o relatório — tente novamente.');
  }
  return result.text;
}
