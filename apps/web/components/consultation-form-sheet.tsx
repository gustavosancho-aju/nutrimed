import {
  ALIMENTACAO,
  DOENCAS_ASSOCIADAS,
  EXAME_FISICO,
  HISTORICO_FAMILIAR,
  OBJETIVOS_TERAPEUTICOS,
  OBJETIVO_PRINCIPAL,
  RISCO_CARDIOMETABOLICO,
  SONO,
  type ConsultationForm,
  type FormOption,
} from '@nutrimed/consultation-form';
import { saveConsultationFormAction } from '@/lib/consultation-form-actions';

/**
 * Ficha de consulta editável (modelo do Dr. Rafael Bastos) — formulário
 * SERVIDOR puro: `<form action={serverAction}>` com defaultValue, sem estado no
 * cliente. A ficha tem ~50 campos e nenhum deles reage a outro; controlá-los em
 * React só adicionaria re-render e um caminho a mais para perder o que foi
 * digitado.
 *
 * O layout segue os 12 blocos do documento em papel, na mesma ordem, para que o
 * médico que preenchia a folha reconheça a tela — e para que a versão impressa
 * (@media print, ver ficha/page.tsx) seja a mesma folha.
 */

const inputClass =
  'w-full rounded-[8px] border border-ink/15 bg-surface-raised px-2.5 py-1.5 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 print:border-0 print:border-b print:border-ink/40 print:bg-transparent print:px-0 print:rounded-none';

const labelClass = 'block text-[11px] font-medium uppercase tracking-wide text-ink-muted';

function Field({
  label,
  name,
  value,
  className = '',
}: {
  label: string;
  name: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClass} htmlFor={`ficha-${name}`}>
        {label}
      </label>
      <input
        id={`ficha-${name}`}
        name={name}
        defaultValue={value ?? ''}
        className={`mt-1 ${inputClass}`}
      />
    </div>
  );
}

function TextArea({
  label,
  name,
  value,
  rows = 2,
}: {
  label: string;
  name: string;
  value: string | null;
  rows?: number;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={`ficha-${name}`}>
        {label}
      </label>
      <textarea
        id={`ficha-${name}`}
        name={name}
        rows={rows}
        defaultValue={value ?? ''}
        className={`mt-1 ${inputClass} leading-relaxed`}
      />
    </div>
  );
}

/**
 * Grupo de checkboxes. Na impressão as caixas viram ( ) / (X) — a ficha em papel
 * usa parênteses, e um checkbox nativo desbotado não se lê numa fotocópia.
 */
function CheckGroup({
  name,
  options,
  selected,
}: {
  name: string;
  options: readonly FormOption[];
  selected: readonly string[];
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        return (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-1.5 text-sm text-ink print:cursor-auto"
          >
            <input
              type="checkbox"
              name={name}
              value={opt.value}
              defaultChecked={checked}
              className="h-3.5 w-3.5 rounded-[3px] border-ink/30 text-brand focus:ring-brand/30 print:hidden"
            />
            <span aria-hidden className="hidden font-mono-data print:inline">
              ({checked ? 'X' : ' '})
            </span>
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-ink/10 pt-4 first:border-t-0 first:pt-0">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function ConsultationFormSheet({
  consultationId,
  form,
}: {
  consultationId: string;
  form: ConsultationForm;
}) {
  return (
    <form action={saveConsultationFormAction} className="space-y-6">
      <input type="hidden" name="consultationId" value={consultationId} />

      <Block title="Identificação">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Nome" name="nome" value={form.identificacao.nome} className="sm:col-span-2" />
          <Field label="Data" name="data" value={form.identificacao.data} />
          <Field label="Idade" name="idade" value={form.identificacao.idade} />
          <Field label="Sexo" name="sexo" value={form.identificacao.sexo} />
          <Field label="Telefone" name="telefone" value={form.identificacao.telefone} />
          <Field
            label="Profissão"
            name="profissao"
            value={form.identificacao.profissao}
            className="sm:col-span-3"
          />
        </div>
      </Block>

      <Block title="Objetivo principal">
        <CheckGroup
          name="objetivoPrincipal"
          options={OBJETIVO_PRINCIPAL}
          selected={form.objetivoPrincipal.marcados}
        />
        <Field label="Outro" name="objetivoOutro" value={form.objetivoPrincipal.outro} />
        <TextArea label="O motivo" name="motivo" value={form.objetivoPrincipal.motivo} />
      </Block>

      <Block title="Peso e composição corporal">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="Peso atual" name="pesoAtual" value={form.antropometria.pesoAtual} />
          <Field label="Peso máximo" name="pesoMaximo" value={form.antropometria.pesoMaximo} />
          <Field
            label="Peso mín. adulto"
            name="pesoMinimoAdulto"
            value={form.antropometria.pesoMinimoAdulto}
          />
          <Field label="Altura" name="altura" value={form.antropometria.altura} />
          <Field label="IMC" name="imc" value={form.antropometria.imc} />
        </div>
      </Block>

      <Block title="Doenças associadas">
        <CheckGroup
          name="doencas"
          options={DOENCAS_ASSOCIADAS}
          selected={form.doencasAssociadas.marcados}
        />
        <TextArea label="Observações" name="doencasObs" value={form.doencasAssociadas.observacoes} />
      </Block>

      <Block title="Histórico familiar">
        <CheckGroup
          name="historico"
          options={HISTORICO_FAMILIAR}
          selected={form.historicoFamiliar.marcados}
        />
        <TextArea
          label="Observações"
          name="historicoObs"
          value={form.historicoFamiliar.observacoes}
        />
      </Block>

      <Block title="Estilo de vida — alimentação">
        <CheckGroup name="alimentacao" options={ALIMENTACAO} selected={form.alimentacao.marcados} />
        <TextArea label="Observações" name="alimentacaoObs" value={form.alimentacao.observacoes} />
      </Block>

      <Block title="Estilo de vida — exercício">
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-ink print:cursor-auto">
          <input
            type="checkbox"
            name="sedentario"
            defaultChecked={form.exercicio.sedentario}
            className="h-3.5 w-3.5 rounded-[3px] border-ink/30 text-brand focus:ring-brand/30 print:hidden"
          />
          <span aria-hidden className="hidden font-mono-data print:inline">
            ({form.exercicio.sedentario ? 'X' : ' '})
          </span>
          Sedentário
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Atividade" name="atividade" value={form.exercicio.atividade} />
          <Field
            label="Frequência/semana"
            name="frequenciaSemanal"
            value={form.exercicio.frequenciaSemanal}
          />
          <Field label="Duração" name="duracao" value={form.exercicio.duracao} />
          <Field label="Intensidade" name="intensidade" value={form.exercicio.intensidade} />
        </div>
      </Block>

      <Block title="Estilo de vida — sono">
        <Field label="Horas/noite" name="horasPorNoite" value={form.sono.horasPorNoite} />
        <CheckGroup name="sono" options={SONO} selected={form.sono.marcados} />
      </Block>

      <Block title="Medicações / suplementos">
        <TextArea label="Uso contínuo" name="usoContinuo" value={form.medicacoes.usoContinuo} />
        <TextArea label="Suplementos" name="suplementos" value={form.medicacoes.suplementos} />
        <TextArea
          label="Hormônios/anabolizantes prévios"
          name="hormoniosPrevios"
          value={form.medicacoes.hormoniosPrevios}
        />
        <TextArea label="Alergias" name="alergias" value={form.medicacoes.alergias} />
      </Block>

      <Block title="Exame físico">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="PA" name="pa" value={form.exameFisico.pa} />
          <Field label="FC" name="fc" value={form.exameFisico.fc} />
        </div>
        <CheckGroup name="exameFisico" options={EXAME_FISICO} selected={form.exameFisico.marcados} />
        <TextArea label="Observações" name="exameFisicoObs" value={form.exameFisico.observacoes} />
      </Block>

      <Block title="Estratificação">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="PREVENT" name="prevent" value={form.estratificacao.prevent} />
        </div>
        <div>
          <span className={labelClass}>Risco cardiometabólico</span>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {RISCO_CARDIOMETABOLICO.map((opt) => {
              const checked = form.estratificacao.riscoCardiometabolico === opt.value;
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-1.5 text-sm text-ink print:cursor-auto"
                >
                  <input
                    type="radio"
                    name="risco"
                    value={opt.value}
                    defaultChecked={checked}
                    className="h-3.5 w-3.5 border-ink/30 text-brand focus:ring-brand/30 print:hidden"
                  />
                  <span aria-hidden className="hidden font-mono-data print:inline">
                    ({checked ? 'X' : ' '})
                  </span>
                  {opt.label}
                </label>
              );
            })}
          </div>
        </div>
      </Block>

      <Block title="Objetivos terapêuticos">
        <CheckGroup
          name="objetivosTerapeuticos"
          options={OBJETIVOS_TERAPEUTICOS}
          selected={form.objetivosTerapeuticos.marcados}
        />
        <TextArea label="Metas" name="metasTerapeuticas" value={form.objetivosTerapeuticos.metas} />
      </Block>

      <Block title="Conduta">
        <TextArea label="Nutrição" name="condutaNutricao" value={form.conduta.nutricao} />
        <TextArea label="Exercício" name="condutaExercicio" value={form.conduta.exercicio} />
        <TextArea label="Medicações" name="condutaMedicacoes" value={form.conduta.medicacoes} />
        <TextArea
          label="Suplementação"
          name="condutaSuplementacao"
          value={form.conduta.suplementacao}
        />
        <TextArea
          label="Solicitação de exames"
          name="condutaExames"
          value={form.conduta.solicitacaoExames}
        />
        <TextArea label="Metas" name="condutaMetas" value={form.conduta.metas} />
      </Block>

      <Block title="Retorno">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Data" name="retornoData" value={form.retorno.data} />
        </div>
        <TextArea label="Observações" name="retornoObs" value={form.retorno.observacoes} />
      </Block>

      <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-ink/10 bg-surface/95 py-3 backdrop-blur print:hidden">
        <p className="text-xs text-ink-muted">
          Rascunho gerado por IA — revise cada campo antes de salvar. Cifrada em repouso e auditada.
        </p>
        <button
          type="submit"
          className="shrink-0 rounded-[10px] bg-brand px-4 py-2 text-xs font-semibold text-on-brand shadow-sm transition-opacity hover:opacity-90"
        >
          💾 Salvar ficha
        </button>
      </div>
    </form>
  );
}
