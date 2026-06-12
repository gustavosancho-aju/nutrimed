# NutriMed — Registro de Implementação (PRD Executado)

> **Data:** 2026-06-11 · **Status:** MVP funcional fim-a-fim (9 de 10 épicos com núcleo implementado)
> **Fontes de requisitos:** `docs/prd.md` (FR1–FR21, NFR1–NFR12) · `docs/architecture.md` (ADR-001–009) · `docs/epics/`
> Este documento registra **o que foi construído e verificado**, rastreado aos requisitos de origem (Article IV).

---

## 1. Visão executiva

O NutriMed saiu de "repositório vazio" para um **produto funcional verificado ao vivo no browser** em uma sequência contínua de implementação:

> Login → consulta → consentimento (default NEGA) → transcrição ao vivo → **board de 3 especialistas de IA** (Dr. Aurélio · Dr. Paulo · Dra. Yara, com retratos gerados) detectando gatilhos clínicos → contribuições reais do **Claude Haiku** ancoradas na KB com proveniência auditada → síntese do Aurélio devolvendo a decisão ao médico → **nota clínica gerada, editável, cifrada e auditada** → **telemetria de custo/ruído/latência** com gatilho Quiet Board.

**Números:** 187 testes PASS · 19 packages/apps · ~30 commits em `github.com/gustavosancho-aju/nutrimed` · custo medido **US$ 0,0108** na consulta simulada (~US$ 0,25 projetado p/ 35min reais).

---

## 2. Status por épico

| Épico | Tema | Status | Evidência |
|---|---|---|---|
| **E1** | Fundação & Compliance | ✅ **100% Done** (8/8 stories + QA gates) | `docs/qa/gates/1.*.yml` |
| **E2** | Pipeline de Transcrição | ✅ 5/6 (falta POC 2.5) | adapters Deepgram/OpenAI + sessão + panel |
| **E3** | Walking Skeleton | ✅ + **mic real** | demo ao vivo; faltam 3.4 (POC LLM) e 3.5 (ADR-010) |
| **E4** | Motores do Board | ✅ núcleo (5/5 stories) | 22 testes engines |
| **E5** | RAG & Persona Reasoner | ✅ núcleo (3/3 stories) | isolamento FR21 testado |
| **E6** | Board Completo + Synthesizer | ✅ núcleo (3/3 stories) | demo 3 personas + síntese ao vivo |
| **E7** | UI do Board | ✅ núcleo (4 stories) + retratos | `produto-final-e7.png`, `produto-com-personas.png` |
| **E8** | Vídeo das Personas | ⬜ **pendente** | retratos Gemini = base dos clipes |
| **E9** | Documentação Clínica | ✅ (3/3 stories) | `nota-clinica-e9.png` |
| **E10** | Observabilidade & Piloto | ✅ núcleo (5/5 stories) | `telemetria-e10.png` |

---

## 3. Rastreabilidade — Requisitos Funcionais (PRD §5)

| FR | Requisito | Status | Onde |
|---|---|---|---|
| FR1 | Transcrição PT-BR em tempo real | ✅ | `stt-deepgram`/`stt-openai` + `session` + `<TranscriptPanel>`; transcript ao vivo no protocolo WS |
| FR2 | 3 personas ativas desde o início | ✅ | `FullBoardOrchestrator` (E6) |
| FR3 | Contribuição proativa gated | ✅ | TriggerDetector → Gate → Reasoner (E4+E5) |
| FR4 | Gatilhos CV do Paulo | ✅ | `PAULO_TRIGGERS` (fármacos+sintomas críticos) |
| FR5 | Gatilhos hormonais da Yara | ✅ | `YARA_TRIGGERS` (tireoide, platô) |
| FR6 | Abertura/síntese do Aurélio | ✅ | Synthesizer automático + prompt "decisão é do médico" |
| FR7 | Divergência transparente | ✅ núcleo | `divergent` no evento/protocolo; render no card |
| FR8 | 4 tipos de contribuição | ✅ | `<SuggestionCard>` (⚠️💡🔍📋 ícone+cor+label) |
| FR9 | Feed inverso + ⚠️ fixos; vídeos | ✅ parcial | feed OK; faixa de vídeo = retratos (E8 anima) |
| FR10 | Estados de vídeo | 🟡 parcial | estados ouvindo/sinalizando na DoctorStrip; clipes = E8 |
| FR11 | Dedup/consolidação | ✅ | `Deduplicator` multi-persona + badge 🤝 |
| FR12 | Surgir em pausas; ⚠️ imediato | ✅ | `PauseGate` 2,5s (A4) |
| FR13 | Silenciar doutor | ✅ | DoctorStrip + store (⚠️ sempre passa) |
| FR14 | Expandir/perguntar | 🟡 parcial | expandir OK; `AskDoctorInput` pendente |
| FR15 | Dispensar ✓ / fixar 📌 | ✅ | com undo 5s |
| FR16 | Modo Foco | ✅ | tecla F + banner + represadas |
| FR17 | Documentação básica | ✅ | `clinical-notes` (E9) |
| FR18 | Síntese sob demanda | ✅ | `synthesizeNow()` + botão 📋 |
| FR19 | Disclaimers persistentes | ✅ | `<DisclaimerNote>` + `<AppChrome>` (toda rota + cards) |
| FR20 | Consentimento de gravação | ✅ | gate de SERVIDOR, default NEGA (1.4) |
| FR21 | Escopo por persona | ✅ | namespaces isolados + prompts anti-extrapolação (T6) |

## 4. Rastreabilidade — NFRs (PRD §6)

| NFR | Requisito | Status | Como |
|---|---|---|---|
| NFR1 | Score de relevância ≥ limiar | ✅ | `RelevanceGate` (0.6; crítico 0.3 — recall) |
| NFR2 | Rate-limit por doutor | ✅ | `DoctorRateLimiter` (2/min; ⚠️ fura sem consumir cota) + fila |
| NFR3 | Decaimento visual | ✅ | `board-decay` 8s (card fica, realce some) |
| NFR4 | Hierarquia de segurança | ✅ | ⚠️ domina em borda/fundo/label/pulso/posição/ARIA |
| NFR5 | Latência fala→texto/render | 🟡 medição | timestamps + telemetria p50/p95; POCs formais pendentes |
| NFR7 | Custo unitário medido | ✅ | telemetria: US$0,0108/consulta simulada; vídeo US$0 (ADR-007) |
| NFR8 | Modularidade de fornecedores | ✅ | 4 interfaces; adapters Deepgram/OpenAI/Anthropic SEM SDK; troca = injeção |
| NFR9 | LGPD/cripto | ✅ | AES-256-GCM em repouso (labels, notas), TLS obrigatório, telemetria sem conteúdo clínico |
| NFR10 | Postura CFM + auditoria | ✅ | `audit_log` append-only (trigger DB); TODA contribuição/síntese/nota auditada com proveniência |
| NFR11 | PT-BR | ✅ | ponta a ponta |
| NFR12 | Confiabilidade de demo | ✅ | demo roteirizada estável + degradação graciosa em todo caminho |

## 5. ADRs

| ADR | Decisão | Status na implementação |
|---|---|---|
| 001 | Monorepo TS | ✅ pnpm workspaces, 19 pacotes |
| 002 | Abstração de fornecedores | ✅ adapters trocáveis sem SDK |
| 003 | WebSocket p/ eventos | ✅ gateway autenticado; áudio em canal próprio `/audio` (não no canal do board) |
| 004 | RAG namespaces + seed→curada | ✅ isolamento testado; re-ingestão sem código (R8) |
| 005 | Orchestrator stateful | ✅ validado de fato (sessões em memória); **ADR-010 formal pendente (3.5)** |
| 006 | Compliance-by-design | ✅ consent default-NEGA, cripto, auditoria, disclaimers desde o dia 1 |
| 007 | Vídeo pré-renderizado | 🟡 retratos prontos; clipes = E8 |
| 008 | Lógica servidor / apresentação cliente | ✅ engines no servidor; decay/foco/undo no cliente |
| 009 | Residência de dados BR | ✅ documentado + checklist jurídico (CJ-1..6 bloqueiam piloto) |

## 6. Arquitetura entregue (packages)

```
apps/web                 Next.js 16: login, painel, TELA DE CONSULTA (transcrição ao vivo +
                         board + nota + telemetria), gateway WS in-process, retratos das personas
packages/shared-types    Protocolo WS v1 (contribution/ping/transcript, aditivo)
packages/domain          CLINICAL_VOCABULARY (boost STT)
packages/crypto          AES-256-GCM (NFR9)
packages/db              Migrations 0001–0004 (PGlite dev / pg prod, TLS)
packages/auth            scrypt + sessões DB-backed (token SHA-256)
packages/consent         Gate de gravação FR20 (servidor, default NEGA)
packages/audit           writeAudit/auditedClinicalWrite/getAuditTrail (append-only)
packages/providers       4 interfaces NFR8 + fakes determinísticos
packages/stt-deepgram    Adapter Deepgram (WS nativo, keywords boost, timestamps)
packages/stt-openai      Adapter OpenAI Realtime (candidato B da POC)
packages/llm-anthropic   Adapter Claude (Haiku default, longForm, onUsage)
packages/session         ConsultationSession (acúmulo, retry/backoff, gate 1.4)
packages/engines         TriggerDetector + Scorer/Gate + RateLimiter + Dedup + PauseGate (E4)
packages/kb              NamespacedKnowledgeStore + ingestão versionada + PersonaReasoner (E5)
packages/board           BoardOrchestrator (3.1) + FullBoardOrchestrator (E6, síntese, divergência)
packages/board-gateway   WS autenticado: /board (eventos) + /audio (mic real)
packages/clinical-notes  Nota clínica (E9): gerar/salvar/carregar cifrada+auditada
packages/telemetry       Custo/gate/latência/ruído + gatilho Quiet Board (E10)
```

## 7. Verificações ao vivo (browser, Playwright)

| Evidência | O que prova |
|---|---|
| `demo-board-e3.png` | 1º card do Dr. Paulo via WS (walking skeleton) |
| `demo-board-completo-e6.png` | 3 personas + síntese automática do Aurélio (Claude real) |
| `produto-final-e7.png` | Tela final: transcrição ao vivo + feed com hierarquia |
| `produto-com-personas.png` | Retratos das personas na faixa do board |
| `nota-clinica-e9.png` | Nota markdown completa gerada/editável |
| `telemetria-e10.png` | Custo US$0,0108 · gate 4/3/3 · p50 5,7s · Quiet Board trigger |
| Smoke Claude Haiku | 1,79s, contribuição clínica em tom de sugestão |
| Smoke Deepgram | auth/protocolo validados (stream abriu/fechou limpo) |
| Mic real (plumbing) | botão ao vivo, WS /audio conectado, pipeline armado sem erros |

## 8. Decisões de implementação relevantes

- **LLM default: claude-haiku-4-5** (~US$0,003/contribuição); tiers podem mixar por persona. STT: Deepgram vs OpenAI decidido por **medição** na POC 2.5, não preferência.
- **Keys nunca no browser**: áudio do mic vai por WS `/audio` autenticado ao servidor.
- **Contratos sempre estendidos aditivamente** (SttOpenOptions, receivedAtMs, modelVersion, personaIds/divergent, transcript msg, hooks de telemetria) — zero quebras em 187 testes.
- **Auditoria ANTES de publicar**: contribuição sem trilha não existe (NFR10).
- **Latência p50 5,7s inclui a espera proposital do PauseGate** — separar processamento de cortesia na POC 3.4.

## 9. Pendências (ordem sugerida)

1. **Teste de voz real** (usuário fala → board responde) — plumbing pronto.
2. **E8 — vídeos das personas** (clipes ouvindo/pensando/sinalizando a partir dos retratos).
3. **POCs formais**: 2.5 (STT: latência+precisão de jargão, 2 candidatos) e 3.4 (LLM fala→render) — keys já no `.env`.
4. **Story 3.5 / ADR-010** (decisão formal de runtime).
5. **QA gates formais** dos épicos 2–10 (E1 já tem).
6. **`AskDoctorInput`** (FR14 completo) e **dedup semântico** (cards repetidos da mesma persona).
7. **Consultoria jurídica** CJ-1..CJ-6 (bloqueia o piloto E10 com pacientes reais, não o dev).
8. **🔐 Rotacionar TODAS as keys** (Anthropic/Deepgram/Gemini — passaram pelo chat) antes de qualquer ambiente compartilhado.

---

*Gerado ao fim do ciclo de implementação de 2026-06-11. Mantido por @pm/@architect; atualizar a cada épico fechado.*
