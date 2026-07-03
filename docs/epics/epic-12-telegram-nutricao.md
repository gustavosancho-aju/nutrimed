# E12 — Bot de Telegram: Foto de Prato → Estimativa Nutricional vs. Metas

> **Autor:** Morgan (@pm) · **Data:** 2026-07-01 · **Status:** Draft · **Tamanho:** L
> **Fonte:** visão de produto (assistente do paciente) · padrão E11 (paciente cifrado + CRUD auditado) · padrão ADR-012 (extração por IA + validação humana) · `CLAUDE.md` (estado MVP)
> **Depende de:** E1 (cripto/auditoria/auth/consent/migrations), E11 (paciente como entidade; `@nutrimed/patients`; `ILabExtractor` como padrão a espelhar) · **Desbloqueia:** acompanhamento assíncrono do paciente entre consultas
> **Requisitos novos propostos:** FR28–FR33, NFR14 (a consolidar no PRD por @pm)
> **ADRs:** [ADR-013](../architecture/project-decisions/adr-013-canal-telegram-lgpd.md), [ADR-014](../architecture/project-decisions/adr-014-identidade-telegram-pareamento.md), [ADR-015](../architecture/project-decisions/adr-015-estimativa-foto-aproximada.md)

---

## Objetivo / Valor de Negócio

Hoje o produto acompanha o paciente **dentro** da consulta. Entre uma consulta e outra, o nutrólogo perde visibilidade: o paciente come sozinho, sem feedback, e volta semanas depois sem dados do dia a dia. O E12 dá a **cada paciente um assistente no Telegram** — **um único bot para todos** — em que ele fotografa o prato e recebe, na hora, uma **estimativa nutricional aproximada** e o **progresso do dia frente às metas** que o **nutricionista** definiu.

Isso transforma o produto de "assistente de consulta" em **plataforma de acompanhamento contínuo**: aumenta adesão do paciente, gera um fluxo de dados (curado por metas humanas) que alimenta a próxima consulta, e reforça o ticket premium — mantendo a postura regulatória: **a IA estima, o humano decide** (metas são do nutricionista; a estimativa é aproximada e não é prescrição).

## Descrição

Um bot de Telegram único, multiplexado por `chat_id`, vinculado ao paciente por **código de pareamento** (não por telefone — ver ADR-014). O nutricionista, na ficha do paciente, **gera o código** e **define as metas** (kcal/proteína/carbo/gordura). O paciente pareia (`/start CÓDIGO`), o que **registra o consentimento do canal** (ADR-013, default NEGA, revogável). A partir daí, o paciente envia a **foto do prato** → o servidor estima os nutrientes com **visão do Claude** (estimador plugável `IFoodEstimator`, espelhando `ILabExtractor`) → registra o consumo **cifrado e auditado** → responde com a estimativa + progresso do dia vs. meta. Comandos `/hoje` (progresso) e `/meta` (metas vigentes).

Reúsa integralmente: cripto AES-256-GCM (`@nutrimed/crypto`), trilha append-only (`@nutrimed/audit`), padrão de gate de consentimento (`@nutrimed/consent`), serviços de paciente/medições (`@nutrimed/patients`), o padrão de extração por IA (`@nutrimed/lab-import` → novo `@nutrimed/food-vision`), e o padrão de runtime singleton (`board-runtime.ts` → `telegram-runtime.ts`).

## Escopo

### IN
- **Migration 0006**: `nutrition_goal` (metas versionadas, cifradas), `food_log_entry` (consumo por foto, cifrado), `telegram_link` (vínculo `chat_id`→paciente + consentimento), `telegram_pairing_code` (código efêmero, só hash).
- **Serviços cifrados/auditados** em `@nutrimed/patients`: metas (`setNutritionGoal`, `loadCurrentNutritionGoal`, `listNutritionGoalHistory`) e food log (`addFoodLogEntry`, `listFoodLogByDay`, `sumFoodLogForDay`).
- **`@nutrimed/telegram-link`** (novo, espelha `@nutrimed/consent`): código de pareamento + `resolvePatientByChat` + gate `isChannelAuthorized` (default NEGA) + `revokeChannel`.
- **`@nutrimed/food-vision`** (novo, espelha `@nutrimed/lab-import`): `IFoodEstimator` + `sanitizeFoodEstimate` + `ClaudeFoodEstimator` (content block de imagem) + `FakeFoodEstimator` + `createFoodEstimator(env)`.
- **`@nutrimed/telegram-bot`** (novo, lógica pura): dispatcher + handlers (`/start`, foto, `/hoje`, `/meta`), sem transporte.
- **Transporte**: route handler `apps/web/app/api/telegram/webhook/route.ts` (produção, valida secret token) + long-polling em dev (`telegram-runtime.ts` singleton) + `setWebhook` idempotente no boot.
- **UI do nutricionista** na ficha do paciente: "Vincular Telegram" (gera código), status/revogar canal, e form de **metas nutricionais** (kcal/macros + vigência).
- **Orientação por IA** curta (via `ILlmProvider`) com **disclaimer obrigatório** (ADR-015).

### OUT
- **Chat conversacional aberto** (responder dúvidas nutricionais livres) — fora do MVP (risco regulatório; ADR-015).
- **Persistência da imagem do prato** — não por default (guarda-se só a estimativa + `photo_ref`; ADR-013).
- **Correção da estimativa pelo nutricionista** na UI — iteração futura (fecha o loop "humano decide").
- **Vínculo por telefone / compartilhamento de contato** — rejeitado como mecanismo de identidade (ADR-014).
- **WhatsApp / app próprio / portal do paciente** — canais reavaliados na comercialização (ADR-013).
- **Processo dedicado do bot** (2º processo no Fly) — caminho de escala, não MVP (ADR-013 Decisão 4).

## Requisitos Rastreados

> Requisitos **novos** introduzidos por este épico (numeração contínua ao PRD; consolidação formal é tarefa de @pm).

- **FR28:** O sistema deve oferecer um **canal de acompanhamento assíncrono do paciente** via bot único de Telegram, vinculado ao paciente por **código de pareamento** gerado pelo nutricionista.
- **FR29:** O paciente deve poder **enviar a foto do prato** e receber uma **estimativa nutricional aproximada** (kcal, proteína, carbo, gordura) com incerteza declarada.
- **FR30:** O nutricionista deve poder definir **metas nutricionais estruturadas** (kcal/proteína/carbo/gordura) por paciente, **versionadas** (histórico + meta vigente).
- **FR31:** O sistema deve **registrar o consumo diário** do paciente e apresentar o **progresso frente à meta** do dia (comandos `/hoje`, `/meta`).
- **FR32:** O canal deve exigir **consentimento do paciente** (default NEGA), habilitado e **revogável** pelo nutricionista.
- **FR33:** O bot deve dar **orientação textual curta** gerada por IA, sempre com **disclaimer** de que é estimativa e não substitui o nutricionista (materializa FR19 no canal do paciente).

- **NFR7 (reúso):** custo dos tokens de visão por foto monitorado via `onUsage` (telemetria E10).
- **NFR8 (reúso):** estimador de visão atrás de `IFoodEstimator`, com fake determinístico (plugável/trocável).
- **NFR9 (reúso):** metas, consumo e mapeamento `chat_id`→paciente cifrados em repouso (blob `values_enc` / `_enc`).
- **NFR10 (reúso):** toda escrita de meta, consumo e vínculo gera trilha de auditoria; estimador registra `modelVersion`.
- **NFR14 (novo — canal externo com consentimento por paciente):** o canal do paciente é externo (Telegram); exige consentimento por canal (default NEGA), **minimização** (nenhum identificador do paciente enviado ao Telegram; só `chat_id`) e **não-persistência da imagem** por default — alinhado a ADR-009/ADR-013.

## Decisões de Arquitetura

- **[ADR-013](../architecture/project-decisions/adr-013-canal-telegram-lgpd.md) (Aceito — direção):** canal Telegram, residência e LGPD — consentimento por canal, minimização, imagem não persistida, canal reavaliável; **bloqueante para piloto real** (CJ-12).
- **[ADR-014](../architecture/project-decisions/adr-014-identidade-telegram-pareamento.md) (Aceito):** identidade por **código de pareamento** (rejeita HMAC de telefone; `phone_enc` não é buscável por IV aleatório).
- **[ADR-015](../architecture/project-decisions/adr-015-estimativa-foto-aproximada.md) (Aceito — direção):** estimativa por foto é **aproximada, não prescrição**; metas são humanas; disclaimer obrigatório; estimador plugável.
- **Hospedagem (route handler no Next):** o webhook é um POST curto → cabe no processo único stateful (ADR-010), entra na porta 3000 já exposta → **sem mudança em `fly.toml`/`Dockerfile`**. Long-polling só em dev.

## Dependências

- **Predecessores:** E1 (cripto/auditoria/auth/consent/migrations), E11 (paciente + `@nutrimed/patients` + padrão `ILabExtractor`).
- **Sucessores diretos:** correção da estimativa pelo nutricionista; portal do paciente; canais alternativos (WhatsApp/app).
- **Acopla com:** E10 (telemetria de custo), E7 (design system reaproveitado na UI do nutricionista).

## Critérios de Aceitação (alto nível)

1. Um paciente é vinculado ao bot **só** por código de pareamento válido; o canal nasce **NEGADO** e só processa após consentimento; o nutricionista pode revogar (FR28, FR32; ADR-013/014).
2. O nutricionista define metas estruturadas versionadas; a meta vigente é a de maior `effective_from ≤ hoje` (FR30).
3. Enviar a foto retorna estimativa aproximada (kcal/macros) com `confidence`, e registra o consumo **cifrado e auditado** (FR29, NFR9/NFR10).
4. `/hoje` mostra consumo do dia vs. meta; `/meta` mostra as metas vigentes; sem meta, o bot informa (não inventa) (FR31; ADR-015).
5. Toda resposta de estimativa traz o **disclaimer** obrigatório; não há chat aberto de dúvidas (FR33; ADR-015).
6. Nenhum identificador direto do paciente é enviado ao Telegram; a imagem não é persistida por default (NFR14; ADR-013).
7. O fluxo opera fim-a-fim em dev com `FOOD_ESTIMATOR=fake` (sem custo/credencial); a suíte permanece verde e os gates `lint`/`typecheck`/`test`/`build` passam.
8. O piloto com **pacientes reais** permanece **bloqueado** até CJ-12 ter parecer jurídico (o desenvolvimento não).

## Riscos Relevantes

- **LGPD / canal externo — Alto:** Telegram fora do BR tensiona ADR-009. Mitigação: consentimento por canal, minimização, imagem não persistida, DPA, termo do paciente, **ADR-013 bloqueante para piloto real** (CJ-12).
- **Bot único / vínculo errado — Médio:** um `chat_id` mal pareado registraria no paciente errado. Mitigação: código de uso único + TTL + índice de vínculo ativo único + gate de consentimento; nunca inferir por telefone (ADR-014).
- **Qualidade da estimativa por foto — Médio:** fotos ambíguas. Mitigação: `confidence` explícito, disclaimer, fake para testar sem custo, futura correção pelo nutricionista (ADR-015).
- **Custo de tokens de visão — Médio (NFR7):** monitorar via `onUsage`; Haiku por default.
- **Webhook no Next como trabalho longo — Baixo:** estimativa ~1–3 s cabe no POST; se crescer, migrar transporte para app dedicado (lógica já isolada no pacote).
- **Timezone do dia — Baixo:** agregação diária precisa de offset BR (−180) explícito (padrão `computeAge`, sem relógio implícito).

## Stories (fases de entrega)

> Ordem: **fundação de dados → vínculo/consentimento → estimador → bot/webhook → orientação → observabilidade.** Começar pela base 100% interna (fake, sem Telegram) isola o risco regulatório da esteira de dev (padrão do projeto).

### Fase 1 — Fundação de dados
1. **12.1** — Migration 0006 + modelo de metas, food log e Telegram (`nutrition_goal`, `food_log_entry`, `telegram_link`, `telegram_pairing_code`) — *@data-engineer · @architect*
2. **12.2** — Serviços cifrados+auditados de metas e food log em `@nutrimed/patients` — *@dev · @data-engineer*

### Fase 2 — Vínculo de identidade + consentimento do canal
3. **12.3** — `@nutrimed/telegram-link`: código de pareamento + `resolvePatientByChat` + gate `isChannelAuthorized` (espelha `@nutrimed/consent`) — *@dev · @architect*
4. **12.4** — UI na ficha do paciente: "Vincular Telegram" (código/status/revogar) + form de metas nutricionais — *@ux-design-expert · @dev*

### Fase 3 — Estimador de foto (visão)
5. **12.5** — `@nutrimed/food-vision`: `IFoodEstimator` + `sanitizeFoodEstimate` + `ClaudeFoodEstimator` (imagem) + `FakeFoodEstimator` + `createFoodEstimator` (espelha ADR-012) — *@dev · @architect*

### Fase 4 — Bot / webhook (transporte)
6. **12.6** — `@nutrimed/telegram-bot` (lógica pura: dispatcher + handlers) + `telegram-runtime.ts` singleton — *@dev · @architect*
7. **12.7** — Route handler `app/api/telegram/webhook/route.ts` (valida secret token) + long-polling em dev + `setWebhook` no boot — *@dev · @devops*

### Fase 5 — Orientação por IA + comandos
8. **12.8** — Feedback consumo vs. meta via `ILlmProvider`; comandos `/hoje` e `/meta`; frame regulatório nas mensagens — *@dev · @architect*

### Fase 6 — Observabilidade e piloto
9. **12.9** — Telemetria de custo de visão por foto (NFR7) + métricas de uso do canal; runbook de deploy do webhook + secrets — *@dev · @devops*
