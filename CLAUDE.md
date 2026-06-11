# NutriMed — Estado do Projeto

> Board de 3 especialistas de IA humanizados (voz+vídeo) para nutrólogos. Fosso = base
> clínica curada por persona, não o avatar. Postura regulatória: "IA assiste, médico decide".
> Stack: pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript · PGlite (dev) / Postgres (prod).

## Monorepo

```
apps/web                 Next.js (shell, login, painel, consulta, rota-gate de captura)
packages/shared-types    Tipos compartilhados (ADR-001)
packages/domain          Health/domínio
packages/crypto          AES-256-GCM em repouso (NFR9)
packages/db              Schema + migrations (SQL inline) + runner PGlite/pg
packages/auth            Senha (scrypt) + sessões DB-backed
packages/consent         Consent Service FR20 — gate de servidor de gravação
packages/providers       4 interfaces de fornecedor (NFR8) + fakes determinísticos
```

Comandos: `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` (todos PASS).

## Épico 1 — Fundação & Compliance ✅ COMPLETO (8/8 Done)

| Story | Tema | Status | Commit local |
|-------|------|--------|--------------|
| 1.1 | Monorepo TS + CI | ✅ Done | `cc27a7a` |
| 1.2 | Autenticação do nutrólogo | ✅ Done | `88cd3db` |
| 1.3 | Modelo de dados base + cripto (NFR9) | ✅ Done | `5d38cd7` |
| 1.4 | Consent Service — gate de gravação (FR20) | ✅ Done | `8ca9679` |
| 1.6 | Provider Abstraction Layer (NFR8) | ✅ Done | `aa0ce03` |
| 1.5 | Audit Service — proveniência (NFR10) | ✅ Done | (ver git log) |
| 1.7 | Disclaimers persistentes (FR19) | ✅ Done | (ver git log) |
| 1.8 | ADR residência BR + checklist jurídico | ✅ Done | (ver git log) |

Testes acumulados: **167/167 PASS** (+1 E2E skipif). ANTHROPIC_API_KEY no .env — smoke real do Haiku OK (1.79s, contribuição clínica em tom de sugestão). Candidatos STT prontos p/ POC 2.5: `@nutrimed/stt-deepgram` (keywords boost) e `@nutrimed/stt-openai` (Realtime, prompt hint) (inclui testes de UI — jsdom + Testing Library). CodeRabbit pre-commit **diferido p/ pre-PR** em todas (CLI exige `auth login` interativo via WSL).

### Destaques de implementação
- **1.4 Consent:** servidor é fonte de verdade; default NEGA. Gate `isCaptureAuthorized`/`assertCaptureAuthorized` + rota `GET /api/consultations/[id]/capture-authorization` (401/403/200). `CONSENT` 1:1 `CONSULTATION`; auditável (`granted_by`+`granted_at`).
- **1.5 Audit:** package `@nutrimed/audit` — `writeAudit` (valida proveniência: gatilho+kb_sources+model_version), `auditedClinicalWrite` (transação atômica; exige sessão única, não Pool), `getAuditTrail`. Migration `0003` torna `audit_log` append-only via trigger plpgsql.
- **1.7 Disclaimers:** `<DisclaimerNote>` Atom (fonte única `DISCLAIMER_TEXT`, variants chrome/card, a11y) + `<AppChrome>` no layout raiz — disclaimer persistente em toda rota (FR19). Vitest agora roda testes de UI (`apps/web`, jsdom).
- **1.6 Providers:** `ISttProvider`, `ILlmProvider`, `IKnowledgeRetriever` (escopo por persona — FR21), `IVideoAssetProvider` (catálogo pré-renderizado — ADR-007). Package sem deps de vendor. Fakes = ativo REUSE p/ E2–E8.

## Épico 2 — Pipeline de Transcrição (em andamento)

| Story | Tema | Executor | Status |
|-------|------|----------|--------|
| 2.1 | ISttProvider real (streaming PT-BR, parciais/finais) | @dev | ✅ Ready for Review |
| 2.2 | Captura de áudio + mic check no lobby (gate 1.4) | @dev | ✅ Ready for Review |
| 2.3 | Consultation Session Service (transcript em memória) | @dev | ✅ Ready for Review |
| 2.4 | `<TranscriptPanel>` auto-follow + estados | @ux-design-expert | ✅ Ready for Review |
| 2.5 | POC STT: ≥2 candidatos, latência NFR5 + precisão T4 | @analyst | Ready |
| 2.6 | Degradação graciosa + boost de vocabulário | @dev | ✅ Ready for Review |

Ordem sugerida: 2.3 (só fakes, sem vendor) → 2.4 → 2.1 (exige credencial de vendor) → 2.2 → 2.6 → 2.5 (POC, exige áudio + 2 vendors).

## Épico 3 — Walking Skeleton do Board (em andamento)

| Story | Tema | Executor | Status |
|-------|------|----------|--------|
| 3.1 | Board Orchestrator mínimo (1 persona, 1 gatilho) | @dev | ✅ Ready for Review |
| 3.2 | WebSocket Gateway (ADR-003) | @dev | ✅ Ready for Review |
| 3.3 | useBoardStream + useBoardStore + 1 card | @dev | ✅ Ready for Review |
| 3.4 | POC LLM ≥2 candidatos (bloqueada em API keys) | @analyst | Ready |
| 3.5 | Validar ADR-005 + ADR-010 runtime | @architect | Ready |

LLM adapters: `@nutrimed/llm-anthropic` (Claude Haiku default) pronto; 2º candidato na 3.4.

**DEMO FIM-A-FIM FUNCIONANDO** (2026-06-11, verificada via browser): login → consulta → consentimento → "▶ Iniciar consulta simulada" → card real do Dr. Paulo gerado pelo claude-haiku-4-5 chega via WS em ~3s. Rota: `/consultations/[id]`. STT roteirizado (mic real = wiring E3 final); gateway WS in-process do Next (PGlite single-process; `apps/web/lib/board-runtime.ts`). Keys em `apps/web/.env.local` (gitignored — Next não lê o .env da raiz).

## Épicos 4 e 5 — Motores + RAG (núcleo implementado)

**E4 (`@nutrimed/engines`)** — 4.1–4.5 ✅ Ready for Review: TriggerDetector por persona (FR3/4/5, zero LLM — T2), scoreMatch+RelevanceGate (NFR1, limiar menor p/ críticos), DoctorRateLimiter+PriorityQueue (NFR2, ⚠️ fura-fila sem consumir cota), Deduplicator com consolidação multi-persona (FR11), PauseGate ≥2,5s (FR12) e **BoardGatekeeper** (pipeline composto: score→dedup→pausa→rate-limit; só 'deliver' chega ao LLM).

**E5 (`@nutrimed/kb`)** — 5.1–5.3 ✅ Ready for Review: NamespacedKnowledgeStore (IKnowledgeRetriever real, FR21 — isolamento testado + rejeição de chunk estrangeiro), pipeline de ingestão versionado com proveniência fonte@versão por chunk (R8: re-ingestão substitui namespace sem código), PersonaReasoner com PERSONA_PROFILES e prompts anti-extrapolação (T6, verificado por teste).

**E6 ✅ NÚCLEO (6.1–6.3 Ready for Review):** `FullBoardOrchestrator` integra tudo — 3 personas simultâneas (FR2), síntese do Aurélio automática+sob demanda (FR6/FR18, auditada), divergência transparente no protocolo (FR7). **Demo do board completo verificada AO VIVO**: Yara (TSH/T4) + Paulo (⚠️ GLP-1+palpitação) + síntese do Aurélio fechando com "A conduta é sua" — claude-haiku real, seed real ingerida (R8).

## Pendências

1. ~~Push bloqueado~~ → **RESOLVIDO (2026-06-11):** remote `git@github.com:gustavosancho-aju/nutrimed.git` via **SSH porta 443** (`~/.ssh/config` → ssh.github.com:443), pois `api.github.com` é **bloqueado na rede** (gh CLI/API indisponíveis — github.com e codeload funcionam). main sincronizada.
2. **CodeRabbit pre-PR** — autenticar a CLI e rodar antes do próximo PR. `gh pr create` indisponível enquanto a API estiver bloqueada (usar web UI se preciso).
3. **Consultoria jurídica externa** — CJ-1…CJ-6 do checklist (`docs/architecture/project-decisions/checklist-consultoria-juridica.md`) bloqueiam o piloto E10, não o dev. Gates de QA do E1 todos emitidos (`docs/qa/gates/1.*.yml` — 1.8 PASS, demais CONCERNS→Done).
4. **Caminho crítico do produto:** E1 → E2 (pipeline transcrição) → E3 (POC latência/custo). Os fakes da 1.6 destravam E3 antes da escolha de vendor.

## Regras de fronteira (resumo)
- `git push` / `gh pr create` / MCP = **@devops exclusivo**.
- @dev faz commit local, nunca push. Story status segue lifecycle `Draft→Ready→InProgress→Ready for Review→Done`.
- Docs de framework (`devLoadAlwaysFiles`: coding-standards/tech-stack/source-tree) **ainda não existem** — seguir padrões do código existente.
