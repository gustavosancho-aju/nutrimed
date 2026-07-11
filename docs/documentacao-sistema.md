# NutriMed — Documentação do Sistema

> Referência única e atual do sistema. Data-base: **2026-07-04** · Produção:
> **https://nutrimed.fly.dev** (main @ `e306f3d`).
> Para o registro histórico do MVP (E1–E10, snapshot 2026-06-11) veja
> [`IMPLEMENTATION-RECORD.md`](IMPLEMENTATION-RECORD.md); para as decisões de arquitetura, os ADRs em
> [`architecture.md`](architecture.md) §10 e `architecture/project-decisions/`.

## Índice

1. [Visão geral](#1-visão-geral)
2. [Stack e princípios de arquitetura](#2-stack-e-princípios-de-arquitetura)
3. [Monorepo — os 26 pacotes](#3-monorepo--os-26-pacotes)
4. [Modelo de dados](#4-modelo-de-dados)
5. [Fluxos principais](#5-fluxos-principais)
6. [Integrações externas e transferência internacional](#6-integrações-externas-e-transferência-internacional)
7. [Segurança e compliance](#7-segurança-e-compliance)
8. [Épicos e estado](#8-épicos-e-estado)
9. [Deploy e operação](#9-deploy-e-operação)
10. [Testes e qualidade](#10-testes-e-qualidade)
11. [Roadmap e pendências](#11-roadmap-e-pendências)

---

## 1. Visão geral

O **NutriMed** é uma ferramenta de apoio à decisão para **nutrólogos**. Durante a consulta,
transcreve a fala em tempo real e um **board de 3 especialistas de IA humanizados** (Dr. Aurélio —
nutrologia, Dr. Paulo — cardiologia, Dra. Yara — endocrinologia) levanta pontos clínicos de forma
**proativa mas sempre consultiva**. Ao fim, gera documentos **rascunho** que o médico revisa, edita
e assume: nota clínica e relatório nutricional. Há um canal opcional de acompanhamento por
**Telegram** (foto de refeição → estimativa nutricional vs. metas).

- **Fosso competitivo:** a base clínica curada por persona e a quantificação determinística (TACO),
  não o avatar.
- **Postura regulatória:** *"IA assiste, o médico decide"* — todo output de IA é rascunho revisável,
  cifrado em repouso e auditado; disclaimers persistentes em toda a interface.
- **Público:** nutrólogos (piloto). Não é ferramenta de autoatendimento do paciente.

---

## 2. Stack e princípios de arquitetura

**Stack:** pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript (strict) · PGlite
(dev, in-process) / Postgres (prod, Neon) · WebSocket nativo · Vitest.

Quatro princípios atravessam todo o código:

1. **Abstração de fornecedores (ADR-002, NFR8).** STT, LLM, recuperação de conhecimento, visão de
   alimentos e extração de laudos ficam atrás de interfaces (`ISttProvider`, `ILlmProvider`,
   `IKnowledgeRetriever`, `IFoodEstimator`, `ILabExtractor`), cada uma com um *fake* determinístico.
   Trocar de fornecedor (ou de região) = nova classe, sem tocar o domínio.
2. **Compliance-by-design (ADR-006).** Cifra em repouso, trilha de auditoria imutável e
   consentimento default-NEGA existem desde o dia 1 — não são remendo.
3. **Determinismo clínico.** Onde há número que importa (nutrientes do relatório), o **código
   calcula** a partir de dados públicos (tabela TACO); a IA só extrai e redige, nunca inventa valor.
4. **Degradação graciosa.** Sem chave de fornecedor, os *fakes* assumem em dev e o sistema informa
   indisponibilidade em prod; leitura durável que falha degrada em vez de derrubar a página.

---

## 3. Monorepo — os 26 pacotes

```
apps/web                  Next.js: login, painel, TELA DE CONSULTA, ficha/dashboard de paciente,
                          gateway WS in-process, webhook do bot Telegram
packages/shared-types     Protocolo WS v1 (contribution/ping/transcript — aditivo)
packages/domain           CLINICAL_VOCABULARY (boost STT, curado) + métricas de acurácia STT
                          (clinicalTermRecall/wordErrorRate/scoreTranscript — POC 2.5)
packages/crypto           AES-256-GCM em repouso (NFR9)
packages/db               Migrations 0001–0010 · SqlExecutor · PGlite (dev) / pg (prod, TLS)
packages/auth             scrypt + sessões DB-backed (token SHA-256)
packages/consent          Gate de gravação FR20 (servidor, default NEGA)
packages/audit            Trilha append-only com proveniência (NFR10)
packages/providers        Interfaces NFR8 + fakes + stripJsonFences (parser único de saída de LLM)
packages/stt-deepgram     Adapter Deepgram (WS nativo; keywords no nova-2, keyterm no nova-3)
packages/stt-openai       Adapter OpenAI Realtime (candidato B da POC)
packages/llm-anthropic    Adapter Claude (Haiku default, longForm, onUsage)
packages/session          ConsultationSession (acúmulo, retry/backoff)
packages/engines          E4: triggers + score/gate + rate-limit + dedup + pausa
packages/kb               E5: namespaces isolados por persona + ingestão versionada + Reasoner
packages/board            E6: FullBoardOrchestrator (3 personas, síntese, divergência, CaseState)
packages/board-gateway    WS autenticado: /board (eventos) + /audio (mic real)
packages/clinical-notes   E9: nota cifrada+auditada + transcript persistido/revisado
packages/telemetry        E10: custo/gate/latência/ruído + gatilho Quiet Board
packages/patients         E11: paciente cifrado + medições (bioimpedância/exames) + metas + computeAge
packages/lab-import       E11: extração de laudo PDF (ILabExtractor: Claude + fake) — ADR-012
packages/food-vision      E12: estimativa nutricional por foto (IFoodEstimator: Claude visão + fake) — ADR-015
packages/telegram-link    E12: pareamento por código + gate de consentimento do canal — ADR-013/014
packages/telegram-bot     E12: lógica pura do bot (handlers de foto/comandos + orientação por IA)
packages/taco             E13: tabela TACO 4ª ed. embarcada (591 alimentos) + busca lexical + porções
packages/nutrition-report E13: recordatório (LLM) → mapeamento TACO → cálculo determinístico → relatório
```

Comandos: `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run dev`.

---

## 4. Modelo de dados

Postgres (Neon, **São Paulo/BR**) em prod; PGlite file-backed em dev. Migrations SQL inline e
idempotentes em `packages/db/src/migrations.ts`, aplicadas no boot. Todo dado sensível é cifrado em
repouso (AES-256-GCM, sufixo de coluna `_enc`).

| Migration | Tabelas / mudança |
|---|---|
| 0001 | `app_user`, `consultation` (base) |
| 0002 | `session` (auth DB-backed) |
| 0003 | `audit_log` (append-only + trigger de imutabilidade) |
| 0004 | `clinical_note` (nota clínica cifrada) |
| 0005 | `patient`, `body_composition`, `lab_exam` + `consultation.patient_id` (nullable) |
| 0006 | `nutrition_goal`, `food_log_entry`, `telegram_link`, `telegram_pairing_code` |
| 0007 | `board_synthesis` (sínteses persistidas) |
| 0008 | `transcript_segment` (finais crus do STT, cifrados) |
| 0009 | `nutrition_report` (relatório + `data_enc` estruturado) |
| 0010 | `transcript_review` (transcrição corrigida pelo médico) |

**Não é persistido:** o áudio bruto da consulta (só a transcrição) e a foto do prato do Telegram
(só o `file_id` de referência — ADR-013). A trilha `audit_log` guarda proveniência
(`triggered_by`, `kb_sources`, `model_version`), não conteúdo clínico.

---

## 5. Fluxos principais

### 5.1 Consulta (fluxo central)

```
login (demo@nutrimed.test) → nova consulta (vincula paciente) → consentimento (default NEGA)
  → /consultations/[id]:
      transcrição AO VIVO + board (3 personas, feed com hierarquia de segurança, Modo Foco tecla F)
      ├─ "▶ Consulta simulada" (STT roteirizado; NÃO persiste transcript — de propósito)
      └─ "🎙️ Consulta ao vivo" (mic → WS /audio → Deepgram; transcript persistido cifrado)
      → contribuições reais do claude-haiku-4-5, auditadas, com memória anti-repetição
        (histórico + skip + dedup semântico Jaccard + CaseState + case review 90s)
      → síntese do Aurélio
      → 📝 REVISÃO DO TRANSCRIT pelo médico (Transcrição Confiável): corrige o que o STT ouviu;
         a versão corrigida (transcript_review) vira a FONTE dos documentos
      → nota clínica (rascunho IA, editável, cifrada+auditada)
      → 🥗 relatório nutricional (TACO): recordatório extraído da transcrição, quantificado
         DETERMINISTICAMENTE, porções assumidas sinalizadas "~estimada", delta vs meta do paciente
      → painel 🩺 Diagnóstico + telemetria (custo/gate/latência/ruído/autonomia)
```

**Transcrição Confiável** (o elo de confiança): o léxico clínico curado reduz corrupções do STT já
na captura; o board é robusto a corrupções via gatilhos; e ao fim o médico revisa o transcript —
os finais crus do STT ficam intactos como proveniência, e a versão revisada alimenta nota e
relatório. `getNoteInputs` prefere a versão revisada quando ela existe.

**Relatório nutricional (E13):** a IA extrai o *recordatório alimentar* (alimentos + porções) da
transcrição; o mapeamento alimento→TACO é lexical (com grau de confiança); o cálculo de kcal/macros
é determinístico em código; a IA redige o texto **proibida de alterar os números**. Cada valor
aponta seu item TACO em `kbSources` (proveniência auditável).

### 5.2 Pacientes e dashboard (E11)

Paciente cifrado com evolução longitudinal: bioimpedância e exames laboratoriais (blob JSON cifrado
por medição — ADR-011), metas nutricionais versionadas (append-only), dashboard de 3 abas, PDF e
**Modo Apresentação** (`/patients/[id]/apresentacao` — figura corporal paramétrica por IMC + régua
OMS). Laudos podem ser extraídos por IA (`ILabExtractor`) com **validação médica obrigatória**
antes de persistir (ADR-012).

### 5.3 Bot de Telegram (E12)

Canal de acompanhamento opt-in: o paciente pareia por **código efêmero** (hash, ADR-014), com
**consentimento por canal** (default NEGA, revogável). Envia foto do prato → `IFoodEstimator`
(Claude visão) estima nutrientes → compara com a meta vigente do dia → responde com disclaimer de
estimativa (ADR-015). A foto não é persistida.

**Uso em grupo (2026-07-11, em produção):** o canal pareado pode ser um **grupo** (paciente +
nutrólogo + nutricionista) — os médicos acompanham as fotos e as respostas do bot em tempo real.
Comandos aceitam a forma `/comando@RafaNutriBot`. Setup: privacy mode **OFF** no @BotFather,
re-adicionar o bot ao grupo e enviar `/start CÓDIGO` no grupo. O vínculo segue sendo **1 chat por
paciente** (grupo OU privado, nunca ambos). Atenção jurídica: o dado clínico circula num chat
coletivo — reforça o item CJ-12.

---

## 6. Integrações externas e transferência internacional

Dado **em repouso no BR** (Neon SP); **processamento** efêmero em fornecedores fora do BR (ADR-009,
art. 33 LGPD com minimização). Detalhe factual completo no
[brief jurídico](architecture/project-decisions/brief-tecnico-juridico.md).

| Fornecedor | Recebe | País | Uso |
|---|---|---|---|
| Deepgram | áudio + transcrição | EUA | STT em tempo real |
| Anthropic (Claude) | trechos de transcrição, contexto do board, recordatório, foto do prato | EUA | Board, documentos, visão |
| Telegram | `chat_id`, mensagens, foto do prato | int'l | Canal de acompanhamento |
| Google Gemini | — (só geração de retratos das personas; **sem** dado de paciente) | EUA | Avatares |
| Neon (Postgres) | dado em repouso | **BR (sa-east-1)** | Banco de produção |
| Fly.io | compute | **BR (GRU)** | Hospedagem |

---

## 7. Segurança e compliance

- **Cifra em repouso:** AES-256-GCM (`@nutrimed/crypto`), chave via secret manager, nunca versionada.
- **Auditoria (NFR10):** `audit_log` append-only com trigger de imutabilidade no banco (rejeita
  UPDATE/DELETE). Toda geração/edição de documento e contribuição registra origem, fontes e versão
  do modelo.
- **Consentimento (FR20):** tabela `consent`, 1:1 com a consulta, **default `granted=false`**; o
  servidor é a fonte de verdade — sem `granted=true`, nenhum áudio é capturado/transmitido.
- **Disclaimers persistentes (FR19):** "Sugestão de apoio. A conduta é sua." em toda tela.
- **LGPD/CFM:** residência no BR (ADR-009). O **checklist de consultoria jurídica**
  (`architecture/project-decisions/checklist-consultoria-juridica.md`, CJ-1..CJ-13) e o **brief
  técnico** deixam a consultoria turnkey. Os itens 🔴 (base legal, retenção, transferência
  internacional, papel da IA, responsabilidade, consentimento do paciente) **bloqueiam o piloto com
  pacientes reais** — não o desenvolvimento.
- **Chaves:** decisão de 2026-07-04 de **não rotacionar** as keys que passaram pelo chat
  (Anthropic/Deepgram/Gemini/Telegram). Reavaliar antes de ambiente compartilhado/comercialização.

---

## 8. Épicos e estado

| Épico | Estado |
|---|---|
| E1 Fundação & Compliance | ✅ 100% Done + QA gates |
| E2 Pipeline de Transcrição | ✅ (falta POC 2.5 formal) |
| E3 Walking Skeleton + mic real | ✅ (faltam 3.4/3.5) |
| E4 Motores (gate/dedup/pausa) | ✅ núcleo |
| E5 RAG namespaces + Reasoner | ✅ núcleo |
| E6 Board completo + Synthesizer | ✅ núcleo |
| E7 UI do Board (+retratos) | ✅ núcleo |
| E8 Vídeo das Personas | ⬜ pendente |
| E9 Documentação Clínica | ✅ |
| E10 Observabilidade & Piloto | ✅ núcleo |
| E11 Pacientes & Dashboard | ✅ completo (4 fases) |
| E12 Bot de Telegram | ✅ completo (9 stories) |
| E13 Relatório Nutricional (TACO) | ✅ completo — em produção |
| Transcrição Confiável (léxico + revisão + POC) | ✅ completo — POC aguarda áudio real |

---

## 9. Deploy e operação

- **Deploy:** `flyctl deploy --remote-only -a nutrimed` (builder remoto). Fly.io GRU + Neon sa-east-1.
- **WS em produção = MESMA porta do HTTP (443):** `BOARD_WS_MODE=attached` + `apps/web/server.mjs`
  (CMD do Dockerfile). Dev local: `next dev` + gateway na 3001. Rollback: `BOARD_WS_MODE=port`.
- **Migrations aplicam no boot** — mudou migration/gateway/runtime? Reinicie o `npm run dev`
  (singletons globais ignoram HMR; PGlite só aplica migration nova no boot).
- **Runtime keys:** o Next NÃO lê o `.env` da raiz — ficam em `apps/web/.env.local` (gitignored).
- **Rede:** `api.github.com` é bloqueado; push via SSH porta 443 e `AIOX_ACTIVE_AGENT=github-devops`.
- Detalhe operacional: [`deploy/RUNBOOK.md`](deploy/RUNBOOK.md).

---

## 10. Testes e qualidade

- **Suíte:** 423 testes PASS (+1 skip), Vitest, com *fakes* determinísticos (sem rede).
- **Gates:** `lint` · `typecheck` · `test` · `build` — todos PASS (26 pacotes).
- **CI (GitHub):** lint · typecheck · test · build · CodeQL · pnpm audit · gitleaks — verde.
- **Verificação ao vivo:** fluxos críticos verificados no browser (login → consulta → board → nota
  → relatório → revisão do transcript), confirmados na fonte (banco cifrado + trilha de auditoria).

---

## 11. Roadmap e pendências

**Ordem sugerida** (o gargalo real não é mais código):

1. **Parecer jurídico (CJ-1..CJ-13)** — destrava o piloto com pacientes reais e o áudio real da
   POC. Brief técnico turnkey já entregue; falta o advogado + regras de negócio (retenção + aceite
   do paciente).
2. **Rodar a POC 2.5** — código pronto (`scripts/poc-stt-score.mjs` + adapter keyterm + métricas em
   `@nutrimed/domain`); falta o insumo (áudio clínico pt-BR, real consentido ou proxy TTS). Ver
   [`poc-2.5-stt-transcricao-confiavel.md`](poc-2.5-stt-transcricao-confiavel.md).
3. **Teste de voz real do médico** (mic → board → nota) — plumbing pronto e endurecido.
4. **E8** — clipes de vídeo das personas (ouvindo/pensando/sinalizando) a partir dos retratos.
5. **POC 3.4/3.5 e ADR-010** (LLM/carga e runtime formal).
6. **QA gates formais** E2–E10 (E1 já tem).
7. **Reavaliar rotação de keys** antes de ambiente compartilhado/comercialização.
8. **Dívidas menores** do code review do PR #1 (não bloqueiam): remover dual-listen da 3001,
   knobs sem config/env, `fromPglite` duplicado em testes.
