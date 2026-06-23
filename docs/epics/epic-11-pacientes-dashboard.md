# E11 — Pacientes & Dashboard de Evolução

> **Autor:** Morgan (@pm) · **Data:** 2026-06-23 · **Status:** Draft · **Tamanho:** L
> **Fonte:** visão de produto (board para nutrólogos) · `docs/architecture.md` §8 (modelo de dados), §3 (serviços cifrados/auditados) · `CLAUDE.md` (estado MVP) · padrão E1 (NFR9/NFR10) e E9 (CRUD cifrado)
> **Depende de:** E1 (cripto/auditoria/auth), E9 (nota clínica — reúso na ficha) · **Desbloqueia:** piloto com acompanhamento longitudinal de pacientes
> **Requisitos novos propostos:** FR22–FR27, NFR13 (a consolidar no PRD por @pm)

---

## Objetivo / Valor de Negócio

Hoje a consulta é um evento isolado: nasce de um **rótulo cifrado solto** preso ao médico, vive durante o atendimento e termina numa nota. Não existe o **paciente como entidade** nem **memória longitudinal** — o nutrólogo não consegue, na consulta seguinte, ver a evolução de peso, composição corporal ou exames daquele paciente.

O E11 introduz o **paciente de primeira classe** e o **acompanhamento de evolução** (bioimpedância + exames laboratoriais), materializados numa **dashboard premium de 3 abas** que o médico apresenta ao próprio paciente. Isso transforma o produto de "assistente de consulta pontual" em **plataforma de acompanhamento** — aumentando retenção, justificando o ticket premium e criando o ativo de dados (curado pelo médico) que reforça o fosso. Tudo mantendo a postura regulatória: **a IA assiste na extração e nos gráficos; o médico revisa e decide** (NFR10).

## Descrição

Promove o paciente a entidade real (dono = médico; PII/saúde cifrada — NFR9), vincula consultas a pacientes (sem quebrar as antigas), e adiciona duas séries temporais de medições por paciente (composição corporal e exames laboratoriais). Cada medição guarda **data + consulta de origem**, com valores cifrados num **blob JSON** decifrado no servidor ao montar a dashboard — mesmo padrão das notas clínicas de E9. Como é "evolução", carregam-se todas as medições do paciente, ordenadas por data, para gráficos de tendência.

A camada de importação de PDF (laudos de BIA/exames) é **aditiva e com degradação graciosa** (NFR13): o médico sobe o PDF → servidor extrai texto → LLM (Claude, já no stack) estrutura nos campos → **tela de confirmação** onde o médico revisa/corrige antes de salvar. A dashboard funciona 100% por **entrada manual** mesmo se a extração falhar.

Reúsa integralmente: cripto AES-256-GCM (`@nutrimed/crypto`), trilha append-only (`@nutrimed/audit`), padrão CRUD cifrado de E9 (`save/load` com `writeAudit`), auth/sessão de E1, design system bege+jade já existente (`card-premium`, `gold-hairline`, tokens `ink`/`brand`/`surface`), e a nota clínica de E9 (exibida na ficha).

## Escopo

### IN
- **Migration 0005**: `patient` (name_enc, phone_enc, birth_date_enc, goal_enc), `consultation.patient_id` (FK **nullable** — não quebra consultas antigas), `body_composition` e `lab_exam` (N por paciente; `measured_at`, `source_consultation_id`, `values_enc` blob JSON cifrado).
- **Serviços CRUD cifrados/auditados** de paciente e medições (padrão E9: `encryptField`/`decryptField` + `writeAudit`).
- **Início de consulta vinculado a paciente**: criar/selecionar paciente (nome, nascimento, telefone) → consulta nasce vinculada (substitui o `patientLabel` solto).
- **Home = lista de pacientes** do médico + "Nova consulta".
- **Ficha** `/patients/[id]`: dados (nome, telefone, nascimento→idade, objetivo) + histórico de consultas → resumo (nota de E9) + link para a dashboard.
- **Dashboard** `/patients/[id]/dashboard` — 3 abas premium (reúsa design system):
  - **Geral**: Peso · Massa Muscular · % Gordura (valor atual + variação vs. anterior + mini-tendência) + Principal Objetivo em destaque.
  - **Bioimpedância**: Peso · Massa Muscular · Massa de Gordura · Cintura Abdominal · IMC · PGC — cada um com gráfico de evolução.
  - **Exames**: LDL · HbA1C · Insulina — valor atual + faixa de referência colorida (verde/amarelo/vermelho) + evolução.
- **Entrada manual** de medições (caminho primário, sempre disponível).
- **Importação de PDF**: upload → extração de texto → estruturação por LLM → **tela de confirmação** (revisar/corrigir) → salva como medição (pré-preenche a entrada manual da Fase 3).

### OUT
- **Módulo de composição corporal por foto** (estimativa fotográfica) — épico futuro próprio (ver memória do produto).
- Integração com aparelhos de BIA/EHR de terceiros via API — iteração futura.
- Compartilhamento da dashboard com o paciente (portal do paciente / link público) — futuro.
- OCR de PDF escaneado por imagem (sem camada de texto) — fora do MVP; tratar como "extração indisponível → entrada manual".
- Faixas de referência personalizadas por médico/laboratório — começa com faixas padrão fixas.

## Requisitos Rastreados

> Requisitos **novos** introduzidos por este épico (numeração contínua ao PRD; consolidação formal no PRD é tarefa de @pm).

- **FR22:** O sistema deve manter o **paciente como entidade** (nome, telefone, data de nascimento → idade derivada, principal objetivo), de propriedade do médico, com PII/saúde cifrada.
- **FR23:** Uma consulta deve poder ser **vinculada a um paciente**; o médico cria/seleciona o paciente ao iniciar a consulta. A home lista os pacientes do médico.
- **FR24:** O sistema deve oferecer uma **ficha do paciente** com seus dados e o **histórico de consultas**, dando acesso ao resumo/nota (E9) de cada uma.
- **FR25:** O sistema deve registrar a **evolução longitudinal** do paciente (composição corporal e exames) e exibi-la numa **dashboard com gráficos de tendência** e variação vs. medição anterior.
- **FR26:** A dashboard de exames deve exibir cada marcador com sua **faixa de referência clínica colorida** (verde/amarelo/vermelho).
- **FR27:** O sistema deve permitir **importar laudos em PDF** (BIA/exames), extraindo os valores com auxílio de IA e exigindo **confirmação/correção do médico antes de salvar** (nunca confiar cego em extração de dado clínico).

- **NFR9 (reúso):** PII e dados de saúde do paciente e das medições cifrados em repouso (AES-256-GCM, sufixo `_enc` / blob `values_enc`).
- **NFR10 (reúso):** toda criação/edição de paciente, medição e importação gera trilha de auditoria; extração por IA registra `modelVersion`.
- **NFR13 (novo — degradação graciosa da extração):** a importação de PDF é estritamente **aditiva**; a dashboard é plenamente operável por entrada manual e a extração por IA nunca grava sem revisão humana — alinhado a NFR10 ("IA assiste, médico decide").

## Decisões de Arquitetura (propostas — formalização por @architect)

- **ADR-011 (proposto):** medições de evolução como **blob JSON cifrado por linha** (`values_enc`), decifrado no servidor ao montar a dashboard — mesmo padrão das notas (E9). Evita N colunas cifradas por marcador, mantém o schema estável quando novos marcadores surgem, e preserva NFR9.
- **ADR-012 (proposto):** **extração de laudos assistida por IA com confirmação humana obrigatória** como padrão de integração de dados clínicos (NFR13/NFR10). O LLM nunca persiste direto; produz um rascunho estruturado para revisão.

## Dependências

- **Predecessores:** E1 (cripto/auditoria/auth/migrations), E9 (padrão CRUD cifrado + nota reaproveitada na ficha).
- **Sucessores diretos:** piloto longitudinal; futuro módulo de composição por foto; futuro portal do paciente.
- **Acopla com:** E7 (design system bege+jade reaproveitado nas telas).

## Critérios de Aceitação (alto nível)

1. Existe o paciente como entidade cifrada (FR22, NFR9); idade é derivada da data de nascimento; consultas antigas (sem `patient_id`) continuam funcionando (FK nullable).
2. Ao iniciar uma consulta, o médico cria/seleciona um paciente e a consulta nasce vinculada (FR23).
3. A home lista os pacientes do médico; a ficha mostra dados + histórico de consultas com acesso à nota de E9 (FR23, FR24).
4. A dashboard exibe 3 abas com valor atual, variação vs. anterior e gráfico de evolução, no design premium existente (FR25).
5. A aba Exames mostra faixa de referência colorida por marcador (FR26).
6. Toda medição/paciente é persistida cifrada e auditada (NFR9/NFR10), verificável por teste (storage ilegível em claro).
7. A importação de PDF apresenta os valores extraídos para revisão/correção antes de salvar; falha de extração degrada para entrada manual sem bloquear a dashboard (FR27, NFR13).
8. A suíte permanece verde (≥187 testes hoje) e os gates `lint`/`typecheck`/`test`/`build` passam.

## Riscos Relevantes

- **Variedade de formatos de laudo (BIA/lab) — Alta:** a extração de PDF é o ponto mais incerto. Mitigação: fasear por último (Fase 4), entrada manual como fallback garantido (NFR13), confirmação humana obrigatória.
- **PII fora da nota — Médio:** nome/telefone/nascimento são PII direta (mais sensível que o rótulo solto atual). Mitigação: reúso estrito do padrão cifrado+auditado de E1/E9; nenhum campo sensível em claro no storage (teste obrigatório).
- **Migração de consultas antigas — Baixo:** `patient_id` nullable evita quebra; consultas legadas mantêm `patient_label_enc`. Sem backfill obrigatório.
- **Scope creep da dashboard — Médio:** limitar aos marcadores especificados; faixas de referência fixas no MVP; sem personalização por laboratório.

## Stories (fases de entrega)

> Ordem confirmada: **fundação → ficha → dashboard manual → PDF**. Começar pela entrada manual antes do PDF garante a dashboard operável mesmo se a extração falhar (degradação graciosa — padrão do projeto).

### Fase 1 — Fundação (materializada como stories)
1. **11.1** — Migration 0005 + modelo de pacientes & evolução (`patient`, `consultation.patient_id`, `body_composition`, `lab_exam`) — *@data-engineer · @architect*
2. **11.2** — Serviços CRUD cifrados + auditados de paciente e medições (padrão E9) — *@dev · @data-engineer*
3. **11.3** — Início de consulta vinculado a paciente (criar/selecionar; substitui rótulo solto) — *@dev · @ux-design-expert*

### Fase 2 — Lista + ficha + histórico (esboço — @sm detalha após Fase 1)
4. **11.4** — Home = lista de pacientes do médico + "Nova consulta" — *@ux-design-expert · @dev*
5. **11.5** — Ficha `/patients/[id]`: dados + histórico de consultas → resumo/nota (E9) + link dashboard — *@ux-design-expert · @dev*

### Fase 3 — Dashboard premium 3 abas, entrada manual (esboço)
6. **11.6** — Primitivas da dashboard: layout premium 3 abas + componente de tendência/variação + cálculo idade/IMC/variação — *@ux-design-expert · @dev*
7. **11.7** — Abas Geral + Bioimpedância: entrada manual + gráficos de evolução — *@dev · @ux-design-expert*
8. **11.8** — Aba Exames: faixas de referência coloridas (verde/amarelo/vermelho) + evolução — *@dev · @ux-design-expert*

### Fase 4 — Importação de PDF (esboço)
9. **11.9** — Upload + extração de texto + estruturação por LLM (rascunho estruturado, sem persistir) — *@dev · @architect*
10. **11.10** — Tela de confirmação/correção → salva como medição; degradação graciosa p/ manual (NFR13) — *@dev · @ux-design-expert*
