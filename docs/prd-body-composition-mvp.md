# NutriMed — Módulo de Composição Corporal por Foto — Product Requirements Document (PRD)

> **Tipo:** PRD de MVP (módulo da plataforma NutriMed)
> **Autor:** Morgan (Product Manager) · **Data:** 2026-06-05 · **Status:** Draft v0.1
> **Comando:** `*create-prd` · **Template:** prd-template-v2
> **Plataforma-mãe:** NutriMed (ver `docs/market-research.md` — Board de Especialistas de IA Humanizados)
> **Base de evidência:** Pesquisa de viabilidade (deep-research, 2026-06-05) — 25 fontes primárias, 13 alegações confirmadas / 12 refutadas por verificação adversarial

---

## 1. Goals and Background Context

### Goals

- Validar a hipótese central: nutricionistas usam consistentemente uma ferramenta que mostra a **evolução** da composição corporal dos pacientes entre consultas, via foto.
- Entregar ao nutricionista a capacidade de **acompanhar pacientes à distância**, sem necessidade de nova consulta presencial ou retorno à clínica.
- Aumentar o **engajamento e a retenção** dos pacientes do nutricionista (paciente que vê progresso, adere mais).
- Posicionar o módulo como **complemento de acompanhamento de tendência** — explicitamente **não** como substituto de bioimpedância (BIA) ou exame diagnóstico.
- Provar valor com **3 a 5 nutricionistas design partners** da rede própria, gerando os primeiros casos de sucesso e dados para decisão de pricing.
- Manter o módulo em **baixo risco regulatório** (ferramenta de apoio, não dispositivo médico/SaMD), via posicionamento e disclaimers desde o dia 1.

### Background Context

O NutriMed é uma plataforma de cuidado nutricional para profissionais, cujo núcleo atual é um board de especialistas de IA que apoia o profissional **durante a consulta**. Este módulo cobre o momento **entre as consultas**: o paciente captura fotos do próprio corpo (frente/lado) somadas a dados antropométricos básicos, e a plataforma estima a composição corporal (% de gordura, massa magra) e — o coração do valor — exibe a **evolução ao longo do tempo**.

A pesquisa de viabilidade (2026-06-05) estabeleceu o guardrail estratégico decisivo: métodos de estimativa por foto e antropometria têm boa concordância no nível de grupo, mas **erro individual amplo** (LoA de ~22 pontos no melhor caso publicado; viés sistemático por sexo/etnia em validações independentes). Críticamente, a própria BIA **só é válida no nível populacional, não individual**. Portanto, "substituir BIA clínica" **não é defensável** com a evidência atual — e tampouco necessário. O valor real e defensável para o nutricionista (que já tem balança de BIA no consultório) não é mais um número absoluto de % de gordura, e sim **ver a tendência de evolução do paciente remotamente**. O MVP existe para testar se esse comportamento se sustenta, antes de qualquer investimento em modelo de IA próprio, validação na população brasileira ou escala comercial.

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-06-05 | 0.1 | Draft inicial do PRD do MVP, derivado de pesquisa de viabilidade e discussão de modelo de negócio | Morgan (PM) |

---

## 2. Requirements

> Cada requisito rastreável. FR = funcional; NFR = não-funcional. Escopo deliberadamente enxuto (MVP de validação).

### Functional

- **FR1:** O nutricionista pode criar uma conta e gerenciar uma lista de seus pacientes na plataforma.
- **FR2:** O nutricionista pode convidar/cadastrar um paciente, gerando um acesso para o paciente realizar capturas.
- **FR3:** O paciente pode realizar uma **captura guiada** de fotos do corpo (no mínimo frente e lado), com instruções visuais de pose, enquadramento e distância.
- **FR4:** O paciente pode informar **dados antropométricos básicos** (peso, altura, idade, sexo) e, opcionalmente, circunferências, vinculados à captura.
- **FR5:** O sistema gera uma **estimativa de composição corporal** (mínimo: % de gordura e massa magra) a partir das fotos + dados, usando um provedor/API de estimativa existente.
- **FR6:** O sistema registra cada medição com **data/hora**, mantendo o histórico por paciente.
- **FR7:** O sistema exibe um **gráfico de evolução/tendência** das métricas ao longo do tempo (núcleo de valor do MVP), priorizando a leitura de tendência sobre o valor absoluto pontual.
- **FR8:** O nutricionista tem um **painel** onde vê a lista de pacientes e, para cada um, a evolução das medições.
- **FR9:** Toda estimativa e tela de resultado exibem **disclaimer visível** de que se trata de uma estimativa de tendência para acompanhamento, **não** um exame diagnóstico nem substituto de bioimpedância.
- **FR10:** O paciente e o nutricionista podem visualizar o histórico de capturas anteriores (fotos e métricas) do paciente.

### Non Functional

- **NFR1:** **Posicionamento e compliance** — em nenhuma tela, texto, material ou notificação o produto pode alegar substituir BIA/DEXA ou realizar diagnóstico. A linguagem é sempre "estimativa de tendência / acompanhamento".
- **NFR2:** **LGPD** — fotos corporais e dados de saúde são dados sensíveis. Consentimento explícito do paciente na captura; armazenamento criptografado; base legal documentada; direito de exclusão atendido.
- **NFR3:** **Mitigação de viés** — como a pesquisa documentou viés por sexo/etnia, os resultados devem ser apresentados como faixa/tendência e acompanhados de ressalva de precisão; evitar precisão falsa (ex.: não exibir casas decimais que sugiram exatidão clínica).
- **NFR4:** **Não construir modelo de IA próprio no MVP** — usar provedor/API de body composition existente. Modelo proprietário e validação na população brasileira são escopo de fase posterior, condicionados à confirmação da hipótese.
- **NFR5:** **Privacidade da imagem** — fotos corporais tratadas com o maior nível de proteção; acesso restrito ao paciente e ao seu nutricionista; nunca expostas publicamente ou usadas para treino sem consentimento explícito.
- **NFR6:** **Simplicidade de adoção** — o onboarding do nutricionista e a captura do paciente devem ser concluíveis sem treinamento (meta: paciente completa a 1ª captura sem suporte).
- **NFR7:** **Custo controlado** — arquitetura modular que permita trocar o provedor de estimativa; o uso de API externa deve ser monitorado por custo/medição.
- **NFR8:** **Plataforma** — web responsivo (funcional em navegador mobile) é suficiente para o MVP; app nativo é fase posterior.
- **NFR9:** **Instrumentação de validação** — o sistema deve registrar métricas de uso (capturas por paciente, frequência de acesso do nutricionista, pacientes ativos) necessárias para avaliar a hipótese central.

---

## 3. User Interface Design Goals

> Visão de alto nível para orientar UX e criação de stories. Não é spec detalhada. (Recomendo handoff a `@ux-design-expert` / Uma para o fluxo detalhado.)

### Overall UX Vision

Duas experiências distintas e simples: a do **paciente** (captura guiada, leve, motivacional — foco em "ver meu progresso") e a do **nutricionista** (painel clínico de acompanhamento — foco em "ver a evolução dos meus pacientes de relance"). A estrela da interface é o **gráfico de evolução**: a tela que comunica progresso de tendência, não o número absoluto isolado.

### Key Interaction Paradigms

- Captura **guiada passo-a-passo** com feedback visual (silhueta de referência, checagem de enquadramento).
- Visualização de progresso baseada em **linha do tempo / gráfico de tendência**.
- Painel do nutricionista com **lista de pacientes** e drill-down para evolução individual.

### Core Screens and Views

- Tela de login / cadastro (nutricionista e paciente)
- Painel do nutricionista (lista de pacientes + status de evolução)
- Tela de detalhe do paciente (gráfico de evolução + histórico)
- Fluxo de captura guiada (paciente)
- Tela de entrada de dados antropométricos (paciente)
- Tela de resultado da medição (com disclaimer)

### Accessibility: WCAG AA

(Meta-alvo; a confirmar com UX. Captura por foto exige atenção a instruções acessíveis.)

### Branding

Herdar identidade da plataforma NutriMed. Tom: clínico-confiável para o nutricionista, encorajador para o paciente. Evitar estética que sugira "exame médico de precisão" (gerenciamento de expectativa de precisão).

### Target Device and Platforms: Web Responsive

Web responsivo com forte uso em navegador mobile (a captura de foto acontece no celular do paciente). App nativo fica para fase posterior.

---

## 4. Technical Assumptions

> Restrições para o Architect (Aria). Decisões a confirmar em handoff.

### Repository Structure: Monorepo

Sugerido monorepo, integrável à base existente do NutriMed (a confirmar com a arquitetura da plataforma-mãe).

### Service Architecture

A definir pelo Architect. Premissa de MVP: aplicação web (front responsivo + backend/API) consumindo **provedor externo de estimativa de composição corporal**. Camada de estimativa **desacoplada** atrás de uma interface, para permitir troca de provedor (NFR7) e futura substituição por modelo próprio.

### Testing Requirements

MVP: Unit + Integration nos fluxos críticos (captura → estimativa → persistência → gráfico). Teste manual de conveniência para o fluxo de captura (depende de imagem real). Validação de comportamento dos disclaimers.

### Additional Technical Assumptions and Requests

- **Provedor de estimativa:** selecionar API/serviço de body composition por foto existente; avaliar precisão divulgada **com ceticismo** (a pesquisa refutou várias alegações de marketing "nível-DEXA"). Critério: viabilidade técnica de integração + custo + termos de uso de imagem (LGPD).
- **Armazenamento de imagens sensíveis:** criptografia em repouso e em trânsito; política de retenção; segregação de acesso.
- **Instrumentação:** analytics de produto desde o início para medir a hipótese (NFR9).
- **Não escopo técnico do MVP:** treino de modelo, reconstrução 3D sofisticada, validação clínica local, integrações com sistemas de clínica.

---

## 5. Epic List

> Sequência lógica; cada épico entrega incremento testável e implantável.

- **Epic 1 — Fundação + Medição (vertical slice):** Estabelecer a base do módulo (auth, gestão paciente, infra) e entregar o primeiro fluxo ponta-a-ponta: paciente captura foto + dados → sistema estima composição → exibe um resultado único com disclaimer.
- **Epic 2 — Acompanhamento de Tendência + Painel do Nutricionista:** Entregar o coração do valor: histórico de medições, gráfico de evolução, e o painel onde o nutricionista acompanha seus pacientes à distância. Instrumentação de validação da hipótese.

> Rationale: dois épicos. O Epic 1 prova a viabilidade técnica do fluxo de medição (risco técnico). O Epic 2 entrega o valor que testa a hipótese de negócio (risco de mercado). Mantém o MVP enxuto; o painel/tendência sem a medição não tem dado, e a medição sem a tendência não tem valor — por isso a sequência.

---

## 6. Epic Details

### Epic 1 — Fundação + Medição (vertical slice)

**Objetivo expandido:** Estabelecer a infraestrutura mínima do módulo dentro da plataforma NutriMed e provar que o fluxo técnico ponta-a-ponta funciona: um paciente consegue, com orientação, capturar fotos e dados, e receber de volta uma estimativa de composição corporal com o devido disclaimer. Ao final deste épico, temos uma medição única funcionando — a fundação para o acompanhamento.

#### Story 1.1 — Fundação do módulo e acesso

As a nutricionista,
I want criar minha conta e acessar o módulo de composição corporal dentro do NutriMed,
so that eu possa começar a cadastrar e acompanhar meus pacientes.

**Acceptance Criteria**
1: Nutricionista consegue se cadastrar/autenticar e acessar a área do módulo.
2: Existe uma tela inicial (painel vazio) indicando "nenhum paciente ainda" e ação para adicionar paciente.
3: A infraestrutura base (repo, app web responsivo, backend, persistência) está estabelecida com uma rota de health-check funcional.
4: Estrutura preparada para LGPD (consentimento e armazenamento seguro) já contemplada no design de dados.

#### Story 1.2 — Cadastro e convite de paciente

As a nutricionista,
I want cadastrar um paciente e gerar um acesso para ele,
so that o paciente possa realizar capturas vinculadas a mim.

**Acceptance Criteria**
1: Nutricionista cadastra um paciente (dados mínimos) e o paciente aparece na sua lista.
2: É gerado um meio de acesso para o paciente (ex.: link/convite) vinculado ao nutricionista.
3: O paciente consegue acessar sua área de captura a partir do convite.
4: Consentimento LGPD do paciente é coletado e registrado antes de qualquer captura.

#### Story 1.3 — Captura guiada de fotos

As a paciente,
I want ser guiado para tirar as fotos do meu corpo corretamente (frente e lado),
so that a estimativa tenha qualidade e eu não precise de ajuda.

**Acceptance Criteria**
1: Fluxo de captura exibe instruções visuais de pose, enquadramento e distância (frente e lado, no mínimo).
2: O sistema valida o mínimo necessário (ex.: presença das fotos exigidas) antes de prosseguir.
3: Captura funciona em navegador mobile (câmera do celular).
4: As imagens são armazenadas de forma criptografada e com acesso restrito (NFR2/NFR5).

#### Story 1.4 — Coleta de dados antropométricos

As a paciente,
I want informar meus dados (peso, altura, idade, sexo),
so that a estimativa combine foto e dados.

**Acceptance Criteria**
1: Formulário coleta peso, altura, idade e sexo (circunferências opcionais).
2: Dados são validados (faixas plausíveis) e vinculados à captura correspondente.
3: Dados ficam disponíveis para a etapa de estimativa.

#### Story 1.5 — Estimativa de composição corporal (integração de provedor)

As a paciente,
I want receber uma estimativa da minha composição corporal após a captura,
so that eu veja um resultado inicial.

**Acceptance Criteria**
1: O sistema envia fotos + dados ao provedor de estimativa (atrás de uma interface desacoplada) e recebe % de gordura e massa magra (mínimo).
2: O resultado é persistido com data/hora, vinculado ao paciente.
3: A tela de resultado exibe a estimativa **com disclaimer visível** (estimativa de tendência, não diagnóstico, não substitui BIA) — FR9/NFR1.
4: O resultado evita precisão falsa (apresentação em faixa/tendência, sem decimais que sugiram exatidão clínica) — NFR3.
5: Falha do provedor é tratada com mensagem clara, sem quebrar o fluxo.

---

### Epic 2 — Acompanhamento de Tendência + Painel do Nutricionista

**Objetivo expandido:** Transformar medições isoladas em **acompanhamento de evolução** — o valor central que testa a hipótese do MVP. O paciente passa a fazer medições recorrentes e ver seu progresso; o nutricionista passa a acompanhar à distância a evolução de toda a sua carteira. Ao final, temos o produto mínimo capaz de validar (ou refutar) a hipótese, com instrumentação para medir o comportamento real.

#### Story 2.1 — Histórico de medições do paciente

As a paciente,
I want fazer novas medições ao longo do tempo e ver as anteriores,
so that eu acompanhe minha jornada.

**Acceptance Criteria**
1: Paciente pode realizar novas capturas recorrentes (reusa fluxo do Epic 1).
2: Todas as medições do paciente ficam listadas em ordem cronológica (fotos + métricas).
3: O paciente acessa o histórico de forma simples a partir da sua área.

#### Story 2.2 — Gráfico de evolução/tendência

As a paciente e como nutricionista,
I want ver a evolução das métricas em um gráfico ao longo do tempo,
so that a tendência fique evidente (o coração do valor).

**Acceptance Criteria**
1: Gráfico exibe a evolução de % de gordura e massa magra ao longo das medições (FR7).
2: A visualização prioriza a **leitura de tendência** (direção e variação) sobre o valor absoluto pontual.
3: A apresentação reforça que se trata de tendência estimada (alinhado a NFR1/NFR3).
4: Funciona com 1, 2 e N medições (estados vazios/iniciais tratados).

#### Story 2.3 — Painel do nutricionista

As a nutricionista,
I want um painel com todos os meus pacientes e a evolução de cada um,
so that eu acompanhe minha carteira à distância sem nova consulta.

**Acceptance Criteria**
1: Painel lista todos os pacientes do nutricionista com indicação de evolução/última medição.
2: Drill-down abre o detalhe do paciente com o gráfico de evolução e o histórico.
3: O nutricionista identifica rapidamente quem progrediu, estagnou ou regrediu (leitura de relance).

#### Story 2.4 — Instrumentação de validação da hipótese

As a product owner do MVP,
I want medir o uso real (capturas, frequência de acesso, pacientes ativos),
so that eu possa validar ou refutar a hipótese central com dados.

**Acceptance Criteria**
1: O sistema registra métricas de uso: nº de capturas por paciente, frequência de acesso do nutricionista, pacientes ativos por nutricionista (NFR9).
2: As métricas ficam acessíveis para análise (mínimo: exportável ou painel interno simples).
3: Eventos-chave da hipótese são rastreáveis (paciente repetiu medição? nutricionista voltou a acessar?).

---

## 7. Checklist Results Report

> _Pendente._ A ser preenchido após execução da `pm-checklist`. Recomendo rodar a checklist antes do handoff para arquitetura.

---

## 8. Next Steps

### UX Expert Prompt

> Uma (@ux-design-expert): Com base neste PRD do Módulo de Composição Corporal (MVP), projete os dois fluxos centrais — **captura guiada do paciente** (mobile-first, sem necessidade de suporte) e **painel de acompanhamento do nutricionista** (leitura de tendência de relance). Atenção especial à tela de **gráfico de evolução** (estrela do produto) e à apresentação que gerencia expectativa de precisão (tendência, não exatidão clínica). Entregue o front-end spec.

### Architect Prompt

> Aria (@architect): Com base neste PRD, desenhe a arquitetura do MVP como **módulo da plataforma NutriMed**. Decisões-chave: (1) interface desacoplada para o **provedor de estimativa de composição corporal** (troca de fornecedor / futura substituição por modelo próprio); (2) armazenamento **seguro de imagens corporais e dados de saúde** sob LGPD (criptografia, retenção, segregação de acesso); (3) instrumentação de analytics de produto para validar a hipótese. Mantenha enxuto — é um MVP de validação, não escala. Não inclua treino de modelo nem validação clínica local (fase posterior).

---

## Anexo — Guardrails de evidência (resumo da pesquisa de viabilidade)

| Tema | Achado verificado | Implicação no PRD |
|------|-------------------|-------------------|
| Precisão por foto | Boa concordância de grupo, MAS erro individual amplo (LoA ~22 pts) | Posicionar como tendência (FR7, NFR1) |
| Viés demográfico | Viés por sexo/etnia em validação independente | Mitigação de viés (NFR3) |
| BIA como referência | Própria BIA não é precisa no nível individual | "Substituir BIA" descartado |
| Concorrentes | Todos se posicionam como complemento, não substituto | Posicionamento de complemento |
| Regulação BR | Lacuna não resolvida (ANVISA RDC 657/751, CFN) | Manter baixo risco + validar juridicamente antes de escalar |
| Alegações de marketing | Várias alegações "nível-DEXA" refutadas | Ceticismo na escolha de provedor |

> **Itens em aberto que precedem a escala (não o MVP):** classificação ANVISA/SaMD do intended use; posição do CFN sobre uso de estimativa por nutricionista; validação na população brasileira; decisão de pricing (após dados dos design partners).

---

*Documento gerado por Morgan (Product Manager) — AIOX. Próximo passo sugerido: validar com `pm-checklist`, depois handoff para @ux-design-expert (fluxos) e @architect (arquitetura).*
