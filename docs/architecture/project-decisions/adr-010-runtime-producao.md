# ADR-010 — Runtime de Produção: Servidor Node Long-Lived Single-Process (não-serverless)

| Campo | Valor |
|---|---|
| **Status** | **Aceito (direção)** — confirma o ADR-005 (antes "Proposto"); confirmação operacional final na execução de infra (follow-up) |
| **Data** | 2026-06-14 |
| **Autor** | Aria (@architect) — Story 3.5 (AC2/AC4) |
| **Fontes** | `apps/web/lib/board-runtime.ts` (singleton `globalThis.__nutrimedBoard`, `BOARD_WS_PORT`, `active: Map` em memória); `docs/architecture.md` §9/§10 (ADR-005 Proposto), §13; `docs/stories/3.5.validar-adr-005-runtime.md` (AC2/AC4); [ADR-009](adr-009-residencia-dados-br.md) (região BR); ADR-002 (abstração de fornecedores); E4 (`packages/engines`), E6 (`packages/board`, `packages/board-gateway`), E10 (`packages/telemetry`) |

## Contexto

O NutriMed já roda fim-a-fim, mas seu modelo de execução nasceu **stateful e single-process** — não por acaso, e sim por necessidade do domínio (board em tempo real com voz). Três fatos do código tornam isso uma **restrição arquitetural dura**, não uma preferência:

1. **Estado de sessão vive em memória do processo.** `apps/web/lib/board-runtime.ts` mantém `active: Map<consultationId, { session, orchestrator, events }>` — a sessão de consulta, o orquestrador do board e o histórico de contribuições (insumo da nota clínica E9) residem no heap do processo Node. Não há, hoje, persistência intermediária desse estado vivo.
2. **O gateway WebSocket vive dentro do processo do Next.** Um singleton `globalThis.__nutrimedBoard` inicializa um `BoardGateway` numa **porta fixa** (`BOARD_WS_PORT`, default 3001) com dois canais persistentes: `/board` (eventos do board) e `/audio` (mic real do navegador → fila → Deepgram). São conexões WS **long-lived** — duram toda a consulta.
3. **O ciclo de vida é o ciclo de vida da conexão.** Áudio chega por `/audio`, atravessa uma fila em memória (`createAudioQueue`), alimenta o STT em streaming, que alimenta o orquestrador, que emite por `/board`. Todo esse pipeline pressupõe um único processo vivo do início ao fim da consulta.

**Implicação direta:** plataformas serverless (Vercel Functions, AWS Lambda, Cloudflare Workers) são **inviáveis** para o núcleo do board. Elas não sustentam (a) WebSocket persistente por minutos, (b) estado compartilhado em memória entre invocações, nem (c) um socket de porta fixa. Forçar serverless exigiria reescrever o runtime (externalizar 100% do estado + broker de mensagens), o que contradiz o código existente, validado e testado (187/187 PASS).

A decisão de runtime estava registrada como **ADR-005 (Proposto)** — este ADR-010 é o follow-up formal que a Story 3.5 (AC2) exige para **confirmá-la**, de modo que E4/E6/E10 construam sobre um modelo de execução *confirmado*, não *proposto*.

## Decisão

1. **Runtime de produção = serviço Node long-lived, single-process, persistente.** Um servidor Node (Next + gateway WS no mesmo processo, como hoje) hospedado em plataforma que mantenha o processo vivo: container gerenciado com presença BR (ex.: **Fly.io região GRU/São Paulo**) ou VM/instância gerenciada em nuvem com região brasileira. **Serverless está descartado** para o núcleo do board (justificativa no Contexto). *(Recomendação de arquitetura — a escolha exata do provedor é follow-up de infra, herdando o critério eliminatório de região BR do ADR-009.)*

2. **Afinidade de sessão por `consultationId` (sticky sessions).** Como o estado vivo de uma consulta reside no processo que a iniciou, **todo o tráfego de uma consulta (HTTP de controle + WS `/board` + WS `/audio`) DEVE ir para a mesma instância**. Na fase inicial isso é trivialmente garantido por **instância única**; ao escalar, exige roteamento *sticky* por `consultationId` (afinidade no load balancer / proxy WS). *(Restrição derivada — AC4.)*

3. **Modelo de concorrência: muitas sessões por processo, NÃO um processo por sessão.** O código já multiplexa sessões num único processo via o `Map active`. Manter esse modelo (um processo atende N consultas concorrentes) — não fork por sessão. Limite de sessões concorrentes por instância é um parâmetro operacional a calibrar com a POC de carga (3.4) e a telemetria E10 (custo/latência por sessão). *(Recomendação — não há medição de capacidade ainda; AC1 cobre a correção do estado, não o teto de carga.)*

4. **Sobrevivência a deploys/restarts = graceful drain, não persistência de estado vivo (nesta fase).** O estado de sessão em memória **não sobrevive** a um restart hoje. A política adotada:
   - **Drain gracioso no deploy:** ao receber sinal de shutdown, a instância **para de aceitar novas consultas**, mantém as ativas até encerrarem (ou até um timeout), e só então termina. Deploys devem ser agendados/anunciados (janela de baixa atividade).
   - **O que já é durável sobrevive:** transcrição, contribuições auditadas (NFR10), consentimento (FR20) e nota clínica (E9) são persistidos em Postgres ao longo da consulta — uma queda perde a *continuidade ao vivo* daquela consulta, não o registro clínico já gravado.
   - **Reconexão do cliente:** o cliente WS deve tentar reconectar; se a instância caiu, a consulta ao vivo é reiniciada (não há replay automático do board nesta fase).
   *(Recomendação de arquitetura — drain e reconnect são padrões a implementar; a story de infra os detalha.)*

5. **Escalabilidade horizontal: documentada, não obrigatória agora.** Duas rotas, com trade-off explícito:

   | Rota | Como | Prós | Contras | Quando |
   |---|---|---|---|---|
   | **A. Sticky + estado em memória** (escolhida p/ início) | LB com afinidade por `consultationId`; cada instância dona de suas sessões | Zero reescrita; menor latência (sem hop de rede p/ estado); coerente com o código atual | Uma instância caída derruba *suas* consultas; balanceamento desigual; sem failover de sessão viva | Piloto e primeiras clínicas |
   | **B. Estado externalizado** (futuro, se a carga exigir) | Sessão/board em Redis (ou similar) + broker pub/sub p/ eventos do board | Failover de sessão; escala mais uniforme; deploy sem drain longo | Reescrita significativa do runtime; +latência por hop; +infra a operar (e Redis precisa de região BR — ADR-009) | Só se a escala/SLA justificar |

   **Decisão:** adotar **A** agora; **B** fica documentada como evolução condicionada a métricas reais (E10), **não** se implementa preventivamente (princípio: generalizar só após ≥2 cenários reais).

## Consequências

**Positivas:**
- Coerência total com o código existente — **zero reescrita** do runtime para ir a produção.
- Latência mínima do board (estado co-localizado com o processamento — crítico para a sensação "ao vivo").
- Caminho de deploy simples e previsível (uma imagem de container; uma região BR).
- Compatível por construção com ADR-009 (basta provedor com região BR).

**Negativas / custos:**
- **Sem failover de sessão viva** na Rota A: instância caída interrompe suas consultas ativas (mitigado por: registro clínico já durável em Postgres + reconnect do cliente).
- **Deploys exigem drain** (não é "rolling" instantâneo) — operação precisa de janela e disciplina.
- **Custo de instância sempre-ligada** (vs. serverless pay-per-use) — esperado e aceitável para um produto de sessões longas.
- **Teto de escala da Rota A** eventualmente força a migração custosa para B — risco assumido conscientemente e monitorado por telemetria.

## Restrições derivadas para E4 / E6 / E10 (AC4)

Sabendo que rodam **num único processo stateful, com N sessões concorrentes**:

- **E4 — Engines (`packages/engines`):** gate, dedup, rate-limit e pausa operam **sobre o estado em memória da sessão**; toda contagem (ex.: `maxPerMinutePerDoctor`) é **por-instância, por-`consultationId`** — correta sob sticky sessions, mas **não** seria correta se o tráfego de uma consulta se espalhasse por instâncias (reforça a Decisão 2). Engines não devem assumir estado global cross-instância.
- **E6 — Board (`packages/board`, `packages/board-gateway`):** o `FullBoardOrchestrator` e seus timers (`tickMs`, `pauseMs`, `synthesisQuietMs`) vivem no processo; **a síntese e a divergência dependem do histórico em memória daquela sessão**. Restrição: encerrar a sessão deve persistir o que a nota clínica (E9) precisa **antes** do drain (já ocorre — `getNoteInputs` lê do estado vivo; a nota é gravada cifrada). Em B (futuro), o orquestrador teria de hidratar estado do store externo.
- **E10 — Telemetria (`packages/telemetry`):** o `TelemetryRegistry` é **por-instância**; métricas (custo/gate/latência/ruído) são locais ao processo. Restrição: ao escalar horizontalmente, a telemetria deve ser **agregada cross-instância** (export para um coletor central) — hoje o `summary()` reflete só a instância local. O "Quiet Board trigger" opera por sessão, então permanece correto sob sticky.

## Relação com outros ADRs

- **ADR-005** (runtime stateful — *Proposto*): este ADR-010 **confirma** formalmente o modelo stateful por sessão. ADR-005 passa de "Proposto" a "confirmado por ADR-010".
- **ADR-009** (residência BR): o provedor de runtime **herda o critério eliminatório de região BR**; qualquer estado externalizado futuro (Redis, Rota B) também reside no BR.
- **ADR-002** (abstração de fornecedores): preservada — STT/LLM continuam trocáveis; esta decisão é sobre *onde o processo roda*, não sobre *quais fornecedores*.
