# Política de Retenção & Exclusão de Dados — PROPOSTA (para ratificação jurídica)

> ⚠️ **Isto NÃO é parecer jurídico.** É uma proposta técnica/de negócio para o
> advogado revisar, ajustar e ratificar (resolve **CJ-2** retenção e **CJ-7**
> direito à eliminação do [checklist](checklist-consultoria-juridica.md)).
> Autor: engenharia · 2026-07-12. Contexto: dado sensível de saúde (LGPD art. 5º
> II), sistema "IA assiste, médico decide". O prontuário médico tem retenção
> MÍNIMA obrigatória (Res. CFM 1.821/2007: 20 anos) que TENSIONA a minimização
> da LGPD (art. 15/16) — o parecer precisa arbitrar esse conflito.

## 1. Princípios propostos

1. **Minimizar o que não é prontuário.** Insumos transitórios (áudio, transcrição
   crua) não precisam viver como o registro clínico final.
2. **Preservar o que é ato clínico.** Nota clínica e relatório assinados/validados
   pelo médico são candidatos ao prazo de prontuário (CFM), não à minimização.
3. **Direito à eliminação com exceção legal.** Atender art. 18 IV/VI, ressalvando
   o que a lei obriga a reter (art. 16 I) e a auditoria de integridade (art. 16 III).
4. **Auditoria sobrevive à exclusão do dado.** O `audit_log` guarda só metadados
   de proveniência (quem/quando/qual modelo) — **sem conteúdo clínico** — então
   pode ser preservado mesmo após apagar o dado pessoal (resolve o conflito CJ-7:
   a trilha imutável não impede a eliminação do dado em si).

## 2. Tabela de retenção proposta (por tipo de dado)

| Dado (tabela) | Contém | Retenção PROPOSTA | Base / observação p/ o advogado |
|---|---|---|---|
| Paciente (`patient`, cifrado) | PII (nome, nascimento, telefone, objetivo) | Enquanto ativo + prazo do prontuário após alta | CFM 20 anos? ou art. 16 I? **arbitrar** |
| Bioimpedância (`body_composition`) | Medições corporais | = prontuário | idem |
| Exames (`lab_exam`) | Marcadores laboratoriais + custom | = prontuário | idem |
| Metas (`nutrition_goal`, `body_goal`) | Alvos definidos pelo médico | = prontuário | conduta clínica |
| **Nota clínica** (`clinical_note`) | Registro clínico validado | **Prazo do prontuário (CFM)** | é o ato clínico — reter |
| **Relatório nutricional** (`nutrition_report`) | Derivado TACO validável | = prontuário | idem |
| **Transcrição crua** (`transcript_segment`) | "O que a máquina ouviu" | **Curto: 30–90 dias** ou descartar após validar a nota | insumo; **CJ-2** — minimizar |
| **Transcrição revisada** (`transcript_review`) | "O que foi dito" (corrigida) | = nota clínica (vira fonte do registro) | reter com a nota |
| Síntese do board (`board_synthesis`) | Apoio à decisão | Curto (= transcrição crua) | insumo, não registro |
| Food log Telegram (`food_log_entry`) | Fotos→estimativa nutricional | **90–180 dias** (acompanhamento), depois agregar/apagar | **CJ-12**; consentimento por canal |
| Canal Telegram (`telegram_link`) | chat_id ↔ paciente | Enquanto vinculado; apagar na revogação | já revogável |
| **Audit log** (`audit_log`) | Metadados de proveniência (sem clínico) | **Longo (= prontuário)**, imutável | integridade art. 16 III — preservar |
| Sessões (`session`) | Tokens de login (hash) | Expira em 7 dias (já implementado) | — |

## 3. Direito à eliminação (art. 18) — o que "apagar um paciente" deve fazer

Quando o titular exercer o direito (ou por fim de finalidade), a exclusão deve,
**em uma transação**:

1. Apagar/anonimizar as tabelas de **dado pessoal e clínico** do paciente e de
   suas consultas (ficha, medições, exames, metas, transcrições, notas,
   relatórios, food log, canal Telegram) — **respeitando a exceção legal** do que
   precisa ser retido (ex.: prontuário no prazo CFM ⇒ possivelmente
   **anonimizar** em vez de apagar, ou reter sob base legal do art. 16 I).
2. **Preservar** o `audit_log` (metadados sem conteúdo) para integridade.
3. Registrar a própria exclusão na trilha (quem pediu, quando, escopo).

**Decisão que o parecer precisa dar (bloqueia a implementação):**
- (a) Apagar de fato **vs** anonimizar (manter estatística sem identificar)?
- (b) O prazo mínimo de prontuário (CFM) **sobrepõe** o pedido de eliminação?
  Se sim, o "apagar" na prática vira "anonimizar + reter registro clínico sob
  base legal", não deleção física.

## 4. Mecanismo técnico (a construir DEPOIS da decisão jurídica)

- `deletePatientCascade(db, patientId, key)` — deleção/anonimização em ordem de
  dependência (filhos→pais), cifrada e **auditada**, preservando `audit_log`.
- Job de expurgo por prazo (cron): apaga transcrição crua/síntese/food log além
  da janela proposta na tabela acima.
- UI: ação "Excluir dados do paciente" na ficha, com confirmação forte + registro.

Não construímos isso ainda **de propósito**: apagar dado clínico real de forma
irreversível é uma decisão que depende do arbitramento (a) e (b) acima. Assim que
o parecer definir, o mecanismo sai em ~1 story.

## 5. Próximo passo

Enviar esta proposta + o [brief técnico-jurídico](brief-tecnico-juridico.md) ao
advogado. O retorno esperado é: prazos ratificados por linha da tabela §2 +
decisão (a)/(b) do §3. Com isso, a implementação do §4 é destravada.
