# NutriMed — PRD Consolidado do Sistema Completo

> **Tipo:** PRD Consolidado do Sistema (fonte de verdade única — produto + implementação + arquitetura + infra/segurança + estado + pendências)
> **Autor:** Morgan (@pm / Strategist) · **Data:** 2026-06-15
> **Status:** **MVP funcional fim-a-fim + pacote de deploy pronto** (9/10 épicos com núcleo implementado e verificado ao vivo; falta E8 — vídeos)
> **Postura regulatória:** "A IA assiste, o médico decide" — apoio à decisão, nunca diagnóstico autônomo.

## Objetivo deste documento

Documento de referência consolidado para reabrir noutro dia e entender **todo o sistema de uma vez**. Onde já existe documento detalhado, este PRD **referencia em vez de copiar**; onde é o único lugar que consolida (requisitos × status, pendências, deploy), é **completo**. Toda afirmação rastreia a uma fonte (Article IV — No Invention).

### Tabela de fontes consolidadas

| Fonte | Caminho | Papel |
|---|---|---|
| PRD de Produto v1.0 | `docs/prd.md` | Núcleo do produto: goals, problema, FR1–FR21, NFR1–NFR12, personas, UX, riscos, roadmap |
| PRD Composição Corporal (MVP) | `docs/prd-body-composition-mvp.md` | Módulo complementar (estimativa por foto, acompanhamento de tendência) |
| Registro de Implementação | `docs/IMPLEMENTATION-RECORD.md` | O que foi construído e verificado; rastreabilidade FR/NFR/ADR; evidências ao vivo |
| Estado do projeto | `CLAUDE.md` | Monorepo de 19 pacotes, fluxo vivo, pendências, avisos operacionais |
| ADR-009 — Residência BR | `docs/architecture/project-decisions/adr-009-residencia-dados-br.md` | Dados de saúde residem no BR (LGPD) |
| ADR-010 — Runtime de produção | `docs/architecture/project-decisions/adr-010-runtime-producao.md` | Node long-lived single-process; **não** serverless; região BR |
| Blueprint de Segurança | `docs/architecture/production-security-blueprint.md` | Arquitetura segura de produção em 5 fases (0–4) |
| RUNBOOK de Deploy | `docs/deploy/RUNBOOK.md` | Caminho de deploy Fly.io (região GRU / São Paulo) |
| Checklist Jurídico | `docs/architecture/project-decisions/checklist-consultoria-juridica.md` | CJ-1..CJ-10 (gate jurídico do piloto) |
| Épicos | `docs/epics/` (E1–E10) | Backlog de épicos e seus objetivos |

---

## 1. Visão executiva

O **NutriMed** é um **board virtual de 3 especialistas de IA humanizados** — Dr. Aurélio Bastos (nutrólogo/anfitrião), Dr. Paulo Tavares (cardiologista) e Dra. Yara Nakamura (endocrinologista) — que acompanham a consulta do nutrólogo **ao vivo** via transcrição em tempo real, sugerindo perguntas e sinalizando pontos clínicos de forma proativa, com síntese final que devolve a decisão ao médico. O **fosso competitivo** é a **base de conhecimento clínica curada por especialidade** (diretrizes ABRAN/SBEM/SBC) — o avatar é encantamento, a base é o diferencial. A postura é regulatória-defensável: **"a IA assiste, o nutrólogo decide"** (CFM/LGPD). `[prd.md §1–2]`

### Mercado (ordem de grandeza — estimativas a validar) `[prd.md §2]`

| Métrica | Valor | Leitura |
|---|---|---|
| **TAM** | ~R$ 86M/ano (~24.000 médicos das 3 especialidades) | — |
| **SAM** | ~R$ 36M/ano (~10.000 nutrólogos ativos com perfil digital) | — |
| **SOM** | ~R$ 270k–900k ARR (~75–250 pagantes em 24 meses) | Nicho premium captável |

**Leitura estratégica:** mercado de **profundidade, não de escala bruta** — ticket alto (R$ 349–499/mês no tier Board), baixa concorrência direta no formato proposto, alta disposição a pagar no nicho premium (emagrecimento/obesidade/longevidade). `[prd.md §2, §9]`

---

## 2. Produto

### Goals `[prd.md §1]`
Validar a adoção do board de 3 IA humanizadas no nicho premium; entregar **segurança clínica e sensação de "estar acompanhado"** em condutas cardiometabólicas (GLP-1, hipertensão, dislipidemia, tireoide); construir/proteger o **fosso** (KB curada); manter postura de **apoio à decisão**; controlar custo unitário (texto + vídeo pré-renderizado, sem voz/TTS no MVP).

### Problema / Oportunidade `[prd.md §2]`
O nutrólogo premium enfrenta três dores simultâneas: (1) **insegurança** em condutas cardiometabólicas complexas; (2) **solidão na decisão** (sem colega especialista ao vivo); (3) **sobrecarga de documentação** (~2h/dia). As soluções existentes resolvem isso de forma fragmentada e genérica (transcrição/copiloto viraram commodity). Ninguém entrega **personas médicas persistentes, humanizadas, verticais e proativas** atuando como board ao vivo — espaço em branco defensável.

### As 3 personas do board (são features, não usuários) `[prd.md §4]`

| Papel | Persona | Arquétipo | Função | Escopo (semente) |
|---|---|---|---|---|
| 🩺 Nutrólogo (anfitrião) | **Dr. Aurélio Bastos** | O Veterano | Ancora, modera, integra e fecha a recomendação | Terapia nutricional, composição corporal, condução do caso (ABRAN) |
| ❤️ Cardiologista | **Dr. Paulo Tavares** | O Estrategista | Protege o risco CV — destrava com segurança | Risco CV, HAS, dislipidemia, segurança CV de fármacos (SBC) |
| 🔬 Endocrinologista | **Dra. Yara Nakamura** | A Decifradora | Investiga o "porquê" metabólico/hormonal | Tireoide, resistência insulínica, GLP-1, reposições (SBEM) |

**Dinâmica do board:** eixo de tensão saudável Yara (aprofundar) ↔ Aurélio (equilibrar/integrar) ↔ Paulo (agir com segurança). Fluxo: Aurélio abre → Yara investiga → Paulo avalia risco → Aurélio sintetiza e devolve a decisão. **Discordância é feature, não bug** — exposta com transparência.

### Cliente humano (quem compra) `[prd.md §3]`
**Primária (MVP):** Dra. Helena — nutróloga de clínica premium de emagrecimento/longevidade, alta maturidade digital, disposição a pagar R$ 300–600/mês. **Secundária (expansão SAM):** Dr. Carlos — generalista, mais sensível a preço. B2B/clínicas = fora do escopo.

### Módulo complementar — Composição Corporal por Foto `[prd-body-composition-mvp.md]`
Módulo **separado** que cobre o momento **entre consultas**: paciente captura fotos (frente/lado) + dados antropométricos → estimativa de composição corporal → **gráfico de evolução/tendência** (o coração do valor). Posicionado **explicitamente como complemento de tendência, NÃO substituto de bioimpedância (BIA) nem diagnóstico** — guardrail derivado da pesquisa de viabilidade (erro individual amplo, LoA ~22 pts; viés por sexo/etnia; própria BIA só válida em nível populacional). Escopo enxuto: 2 épicos (Fundação+Medição; Tendência+Painel), usa **provedor externo de estimativa** (não constrói modelo de IA próprio no MVP), 3–5 nutricionistas design partners. **Status:** PRD Draft v0.1 — **não implementado** (o sistema construído é o board da consulta).

---

## 3. Requisitos — consolidado FR/NFR × status de implementação

> Cruzamento `docs/prd.md` (definição) × `docs/IMPLEMENTATION-RECORD.md` (status verificado). Legenda: ✅ implementado/verificado · 🟡 parcial · ⬜ pendente.

### Functional Requirements (FR1–FR21)

| FR | Requisito (resumo) | Status | Onde / Nota |
|---|---|---|---|
| FR1 | Transcrição PT-BR em tempo real | ✅ | `stt-deepgram`/`stt-openai` + `session` + `<TranscriptPanel>` |
| FR2 | 3 personas ativas desde o início | ✅ | `FullBoardOrchestrator` (E6) |
| FR3 | Contribuição proativa por gatilho (gated) | ✅ | TriggerDetector → Gate → Reasoner (E4+E5) |
| FR4 | Gatilhos de segurança CV do Paulo | ✅ | `PAULO_TRIGGERS` (fármacos + sintomas críticos) |
| FR5 | Gatilhos hormonais/metabólicos da Yara | ✅ | `YARA_TRIGGERS` (tireoide, platô) |
| FR6 | Abertura/síntese do Aurélio | ✅ | Synthesizer automático ("decisão é do médico") |
| FR7 | Divergência transparente | ✅ núcleo | `divergent` no protocolo; render no card |
| FR8 | 4 tipos de contribuição (⚠️💡🔍📋) | ✅ | `<SuggestionCard>` (ícone+cor+label) |
| FR9 | Feed inverso + ⚠️ fixos + faixa de vídeos | ✅ parcial | feed OK; faixa = retratos (E8 anima) |
| FR10 | Estados de vídeo (ouvindo/pensando/sinalizando) | 🟡 | estados na DoctorStrip; clipes animados = E8 |
| FR11 | Dedup/consolidação multi-persona | ✅ | `Deduplicator` + badge 🤝 |
| FR12 | Surgir em pausas; ⚠️ imediato | ✅ | `PauseGate` 2,5s |
| FR13 | Silenciar doutor | ✅ | DoctorStrip + store (⚠️ sempre passa) |
| FR14 | Expandir / perguntar mais | 🟡 | expandir OK; `AskDoctorInput` pendente |
| FR15 | Dispensar ✓ / fixar 📌 | ✅ | com undo 5s |
| FR16 | Modo Foco (só ⚠️) | ✅ | tecla F + banner + represadas |
| FR17 | Documentação básica (nota clínica) | ✅ | `clinical-notes` (E9) |
| FR18 | Síntese sob demanda | ✅ | `synthesizeNow()` + botão 📋 |
| FR19 | Disclaimers persistentes | ✅ | `<DisclaimerNote>` + `<AppChrome>` (toda rota) |
| FR20 | Consentimento de gravação | ✅ | gate de **servidor**, default **NEGA** |
| FR21 | Escopo por persona (anti-extrapolação) | ✅ | namespaces isolados + prompts |

**Agregado FR:** 21 total → **18 ✅** · **3 🟡** (FR9, FR10, FR14) · 0 ⬜.

### Non-Functional Requirements (NFR1–NFR12)

| NFR | Requisito (resumo) | Status | Como |
|---|---|---|---|
| NFR1 | Score de relevância ≥ limiar | ✅ | `RelevanceGate` (0.6; crítico 0.3) |
| NFR2 | Rate-limit por doutor | ✅ | `DoctorRateLimiter` (2/min; ⚠️ fura sem consumir cota) |
| NFR3 | Decaimento visual | ✅ | `board-decay` 8s |
| NFR4 | Hierarquia visual de segurança | ✅ | ⚠️ domina em borda/fundo/label/pulso/ARIA |
| NFR5 | Latência fala→render | 🟡 | telemetria p50/p95; POCs formais pendentes |
| NFR6 | Qualidade de vídeo (anti-uncanny) | ⬜ | depende de E8 (clipes) |
| NFR7 | Custo unitário controlado | ✅ | US$ 0,0108/consulta simulada; vídeo US$0 |
| NFR8 | Modularidade de fornecedores | ✅ | 4 interfaces; adapters sem SDK; troca = injeção |
| NFR9 | LGPD / cripto | ✅ | AES-256-GCM em repouso, TLS, telemetria sem conteúdo clínico |
| NFR10 | Postura CFM + auditoria | ✅ | `audit_log` append-only; toda contribuição auditada |
| NFR11 | PT-BR ponta a ponta | ✅ | — |
| NFR12 | Confiabilidade de demo | ✅ | demo roteirizada estável + degradação graciosa |

**Agregado NFR:** 12 total → **10 ✅** · **1 🟡** (NFR5) · **1 ⬜** (NFR6, ligado a E8).

> **Status agregado geral:** 33 requisitos (21 FR + 12 NFR) → **28 ✅ · 4 🟡 · 1 ⬜**. Os parciais/pendentes concentram-se em **vídeo das personas (E8)** e **medição formal de latência (POCs)**.

---

## 4. Arquitetura e stack

**Stack:** pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript · PGlite (dev) / Postgres (prod, TLS). **Monorepo de 19 pacotes** `[CLAUDE.md / IMPLEMENTATION-RECORD §6]`:

| Pacote | Responsabilidade (1 linha) |
|---|---|
| `apps/web` | Next.js: login, painel, tela de consulta (transcrição + board + nota + telemetria), gateway WS in-process, retratos |
| `packages/shared-types` | Protocolo WS v1 (contribution/ping/transcript, aditivo) |
| `packages/domain` | CLINICAL_VOCABULARY (boost STT) |
| `packages/crypto` | AES-256-GCM (NFR9) |
| `packages/db` | Migrations 0001–0004 (PGlite dev / pg prod, TLS) |
| `packages/auth` | scrypt + sessões DB-backed (token SHA-256) |
| `packages/consent` | Gate de gravação FR20 (servidor, default NEGA) |
| `packages/audit` | Trilha append-only com proveniência (NFR10) |
| `packages/providers` | 4 interfaces NFR8 + fakes determinísticos |
| `packages/stt-deepgram` | Adapter Deepgram (WS nativo, keywords, timestamps) |
| `packages/stt-openai` | Adapter OpenAI Realtime (candidato B da POC) |
| `packages/llm-anthropic` | Adapter Claude (Haiku default, longForm, onUsage) |
| `packages/session` | ConsultationSession (acúmulo, retry/backoff, gate 1.4) |
| `packages/engines` | E4: TriggerDetector + Scorer/Gate + RateLimiter + Dedup + PauseGate |
| `packages/kb` | E5: NamespacedKnowledgeStore + ingestão versionada + PersonaReasoner |
| `packages/board` | E6: BoardOrchestrator + FullBoardOrchestrator (síntese, divergência) |
| `packages/board-gateway` | WS autenticado: `/board` (eventos) + `/audio` (mic real) |
| `packages/clinical-notes` | E9: nota clínica cifrada + auditada |
| `packages/telemetry` | E10: custo/gate/latência/ruído + gatilho Quiet Board |

**Comandos:** `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run dev`. **Suíte:** 187/187 PASS; todos os gates PASS (19 pacotes).

### ADRs (001–010) `[IMPLEMENTATION-RECORD §5 + ADR-009/010]`

| ADR | Decisão | Status |
|---|---|---|
| 001 | Monorepo TS | ✅ pnpm workspaces, 19 pacotes |
| 002 | Abstração de fornecedores | ✅ adapters trocáveis sem SDK |
| 003 | WebSocket p/ eventos | ✅ gateway autenticado; áudio em `/audio` próprio |
| 004 | RAG namespaces (seed→curada) | ✅ isolamento testado; re-ingestão sem código |
| 005 | Orchestrator stateful | ✅ validado; **confirmado formalmente por ADR-010** |
| 006 | Compliance-by-design | ✅ consent default-NEGA, cripto, auditoria, disclaimers |
| 007 | Vídeo pré-renderizado | 🟡 retratos prontos; clipes = E8 |
| 008 | Lógica servidor / apresentação cliente | ✅ engines no servidor; decay/foco/undo no cliente |
| 009 | Residência de dados BR | ✅ Aceito (direção); confirmação final via consultoria jurídica |
| 010 | Runtime de produção | ✅ Aceito (direção): Node long-lived single-process |

### Decisão de runtime (ADR-010 — load-bearing para deploy) `[adr-010]`
O modelo de execução é **stateful single-process por necessidade do domínio**: estado de sessão vive em memória (`Map<consultationId>` em `apps/web/lib/board-runtime.ts`), e o gateway WS (`/board` + `/audio`, porta 3001) vive **dentro** do processo do Next. **Implicação dura:** **serverless (Vercel/Lambda/Workers) é inviável** para o núcleo do board. Produção = serviço Node long-lived em região BR, com **afinidade sticky por `consultationId`**, **muitas sessões por processo**, e **graceful drain** em deploys (estado vivo não sobrevive a restart; o registro clínico durável em Postgres sim). Escala horizontal: Rota A (sticky + memória) agora; Rota B (estado externalizado em Redis) documentada como evolução condicionada a métricas reais.

---

## 5. Estado atual por épico (E1–E10) `[IMPLEMENTATION-RECORD §2]`

| Épico | Tema | Status |
|---|---|---|
| **E1** | Fundação & Compliance | ✅ **100% Done** (8/8 stories + QA gates formais) |
| **E2** | Pipeline de Transcrição | ✅ 5/6 (falta POC formal 2.5) |
| **E3** | Walking Skeleton + mic real | ✅ (faltam 3.4 POC LLM e 3.5/ADR-010 confirmado) |
| **E4** | Motores do Board (gate/dedup/pausa/rate-limit) | ✅ núcleo (5/5) |
| **E5** | RAG namespaces + Persona Reasoner | ✅ núcleo (3/3); isolamento FR21 testado |
| **E6** | Board completo + Synthesizer | ✅ núcleo (3/3); 3 personas + síntese ao vivo |
| **E7** | UI do Board (+retratos Gemini) | ✅ núcleo (4 stories) |
| **E8** | Vídeo das Personas | ⬜ **pendente** (retratos = base dos clipes) |
| **E9** | Documentação Clínica | ✅ (3/3); nota cifrada+auditada |
| **E10** | Observabilidade & Piloto | ✅ núcleo (5/5); telemetria custo/gate/latência/ruído |

**Métricas medidas:** custo **US$ 0,0108** na consulta simulada (~US$ 0,25 projetado p/ 35min reais); p50 ~5,7s (inclui espera proposital do PauseGate).

---

## 6. Infraestrutura, segurança e deploy

### Blueprint de segurança — 5 fases (gates bloqueantes) `[production-security-blueprint.md §9]`
Estado atual: o MVP funciona **apenas localmente** — **não há Dockerfile/IaC** no código original; já existem cripto, auditoria, consentimento, auth e telemetria. Caminho até produção defensável:

| Fase | Objetivo | Gate de saída (bloqueante) |
|---|---|---|
| **0 — Perímetro** | Estancar exposição | 🔐 rotacionar todas as keys vazadas; segredos no cofre; scan de segredos |
| **1 — Fundação de infra** | Deployável em BR | Containerizar Node; Postgres BR + TLS; KMS BR (chave separada de backups); instância única sticky |
| **2 — Hardening** | Runtime + pipeline | CI com gates (lint/typecheck/187 testes/build + CodeQL + Dependabot); rate-limit login + MFA médicos; auditoria imutável; logs sem PII + Sentry |
| **3 — Jurídico** | Liberar paciente real | Parecer **CJ-1..CJ-6** documentado e incorporado |
| **4 — Piloto** | Operar com clínicas | Telemetria E10 em prod; revisar teto de carga; Rota B só se métricas exigirem |

**Sequência de bloqueio:** Fase 0 antes de qualquer ambiente compartilhado; **Fase 3 antes de qualquer paciente real** (mesmo que 1–2 estejam tecnicamente prontas).

### Caminho de deploy — Fly.io GRU `[deploy/RUNBOOK.md]`
Pacote de deploy **preparado** (artefatos criados; nada provisionado ainda). Fases do runbook: (0) rotação de keys + gerar `DATA_ENCRYPTION_KEY`; (1) conta Fly + `fly launch --no-deploy --region gru`; (2) **Postgres em região São Paulo** — recomendado **Neon ou Supabase** (cert de CA pública satisfaz `ssl.rejectUnauthorized=true` sem alterar código; Fly Postgres interno tem fricção de TLS); migrations 0001–0004 aplicadas automaticamente no 1º boot; (3) secrets via `fly secrets` (DATABASE_URL, ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, DATA_ENCRYPTION_KEY — `GEMINI_API_KEY` **não** entra no runtime); (4) `flyctl deploy` + verificação + teste de voz real.

**Warm-up do WS — RESOLVIDO (2026-06-14):** `apps/web/instrumentation.ts` chama `getBoardRuntime()` no boot, então a porta 3001 sobe junto com o Next (não mais preguiçosamente na primeira consulta). `[RUNBOOK — bloqueador resolvido]`

> **Avisos operacionais `[CLAUDE.md]`:** Next NÃO lê `.env` da raiz (keys de runtime em `apps/web/.env.local`); mudou gateway/runtime/migrations → REINICIE `npm run dev` (singletons ignoram HMR); `api.github.com` bloqueado nesta rede → push via SSH porta 443, PRs pela web; push exige `AIOX_ACTIVE_AGENT=github-devops`.

---

## 7. Compliance & jurídico

- **Postura CFM:** "IA assiste, médico decide" (NFR10) — apoio à decisão, nunca diagnóstico autônomo; trilha de auditoria com proveniência + disclaimers persistentes (FR19). `[prd.md R1]`
- **LGPD:** dados sensíveis de saúde cifrados em repouso (AES-256-GCM) e trânsito (TLS); consentimento server-side default-NEGA (FR20); telemetria sem conteúdo clínico. `[NFR9]`
- **Residência BR (ADR-009):** dados duráveis (Postgres, backups, storage) **no Brasil**; processamento efêmero por STT/LLM externos tratado como transferência internacional (art. 33) com **minimização** (só o trecho necessário, sem identificador do paciente).
- **Gate jurídico do piloto (CJ-1..CJ-6, 🔴 bloqueantes):** base legal (CJ-1), retenção de áudio/transcrição (CJ-2), residência/transferência (CJ-3), papel assistivo da IA/CFM (CJ-4), responsabilidade médica/termos (CJ-5), consentimento paciente×médico (CJ-6). **O piloto com pacientes reais NÃO inicia sem parecer documentado destes 6.** Evolutivos: CJ-7 (direito de eliminação × imutabilidade), CJ-8 (RIPD/DPIA), CJ-9 (licenciamento da KB), CJ-10 (incidentes ANPD). **Bloqueia o piloto, não o desenvolvimento.** `[checklist-consultoria-juridica.md]`

---

## 8. Pendências e roadmap (consolidado)

### A. Destrava o deploy técnico (primeiro ambiente)
1. 🔐 **Rotacionar TODAS as keys** (Anthropic/Deepgram/Gemini — passaram pelo chat) — **Fase 0, bloqueante de qualquer ambiente compartilhado**. `[CLAUDE.md #7 / Blueprint Fase 0]`
2. **Provisionar infra** (containerizar Node + Postgres BR + secrets no cofre) seguindo o RUNBOOK Fly.io GRU — **Fase 1**.
3. **Teste de voz real fim-a-fim** (usuário fala → board reage) — plumbing pronto, falta executar. `[CLAUDE.md #1]`

### B. Destrava o piloto com paciente real
4. **Consultoria jurídica CJ-1..CJ-6** — gate bloqueante do piloto E10. `[checklist-consultoria-juridica.md]`
5. **Hardening de produção** (Fase 2): CI com gates, MFA médicos, auditoria imutável, logs sem PII + Sentry.

### C. Qualidade / rigor / completude de produto
6. **E8 — vídeos das personas** (clipes ouvindo/pensando/sinalizando a partir dos retratos) — fecha FR10, NFR6, ADR-007. `[CLAUDE.md #2]`
7. **POCs formais** 2.5 (STT: latência+jargão, 2 candidatos) e 3.4 (LLM fala→render) — keys já no `.env`. `[IMPLEMENTATION-RECORD #3]`
8. **QA gates formais E2–E10** (E1 já tem). `[CLAUDE.md #4]`
9. **`AskDoctorInput`** (FR14 completo) + dedup semântico. `[CLAUDE.md #5]`

---

## 9. Como testar agora (fluxo local)

`[CLAUDE.md — fluxo vivo]`

1. `npm run dev` (reinicie após mudar gateway/runtime/migrations).
2. **Login:** `demo@nutrimed.test` / `nutrimed123`.
3. Criar/abrir **consulta** → tela `/consultations/[id]`.
4. **Consentimento** (default **NEGA** — é preciso conceder explicitamente).
5. Escolher o caminho:
   - **"▶ Consulta simulada"** — STT roteirizado (demo estável, sem mic).
   - **"🎙️ Consulta ao vivo"** — mic real → WS `/audio` → Deepgram.
6. Observar: **transcrição ao vivo** + **board** (3 personas com retratos, feed com hierarquia de segurança, **Modo Foco** tecla F) → contribuições reais do **claude-haiku-4-5** auditadas → **síntese do Aurélio** → **nota clínica** gerada/editável (cifrada+auditada) → **telemetria** (custo/gate/latência/ruído).

---

*PRD Consolidado gerado por Morgan (@pm / Strategist) — AIOX. Consolida fontes existentes sem inventar requisitos (Article IV). Atualizar quando E8 fechar, POCs formalizarem ou a consultoria jurídica concluir CJ-1..CJ-6.*
