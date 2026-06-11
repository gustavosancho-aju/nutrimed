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

## Épico 1 — Fundação & Compliance (TODAS as 8 stories implementadas)

| Story | Tema | Status | Commit local |
|-------|------|--------|--------------|
| 1.1 | Monorepo TS + CI | ✅ Done | `cc27a7a` |
| 1.2 | Autenticação do nutrólogo | ✅ Ready for Review | `88cd3db` |
| 1.3 | Modelo de dados base + cripto (NFR9) | ✅ Ready for Review | `5d38cd7` |
| 1.4 | Consent Service — gate de gravação (FR20) | ✅ Ready for Review | `8ca9679` |
| 1.6 | Provider Abstraction Layer (NFR8) | ✅ Ready for Review | `aa0ce03` |
| 1.5 | Audit Service — proveniência (NFR10) | ✅ Ready for Review | (ver git log) |
| 1.7 | Disclaimers persistentes (FR19) | ✅ Ready for Review | (ver git log) |
| 1.8 | ADR residência BR + checklist jurídico | ✅ Ready for Review | (ver git log) |

Testes acumulados: **65/65 PASS** (inclui testes de UI — jsdom + Testing Library). CodeRabbit pre-commit **diferido p/ pre-PR** em todas (CLI exige `auth login` interativo via WSL).

### Destaques de implementação
- **1.4 Consent:** servidor é fonte de verdade; default NEGA. Gate `isCaptureAuthorized`/`assertCaptureAuthorized` + rota `GET /api/consultations/[id]/capture-authorization` (401/403/200). `CONSENT` 1:1 `CONSULTATION`; auditável (`granted_by`+`granted_at`).
- **1.5 Audit:** package `@nutrimed/audit` — `writeAudit` (valida proveniência: gatilho+kb_sources+model_version), `auditedClinicalWrite` (transação atômica; exige sessão única, não Pool), `getAuditTrail`. Migration `0003` torna `audit_log` append-only via trigger plpgsql.
- **1.7 Disclaimers:** `<DisclaimerNote>` Atom (fonte única `DISCLAIMER_TEXT`, variants chrome/card, a11y) + `<AppChrome>` no layout raiz — disclaimer persistente em toda rota (FR19). Vitest agora roda testes de UI (`apps/web`, jsdom).
- **1.6 Providers:** `ISttProvider`, `ILlmProvider`, `IKnowledgeRetriever` (escopo por persona — FR21), `IVideoAssetProvider` (catálogo pré-renderizado — ADR-007). Package sem deps de vendor. Fakes = ativo REUSE p/ E2–E8.

## Pendências

1. **Push / PR bloqueado** — 5 commits locais não-pushados (`cc27a7a 5d38cd7 88cd3db 8ca9679 aa0ce03`).
   Push é **exclusivo do @devops**; `gh auth login -h github.com` ainda pendente (bootstrap do repo).
2. **Quality gates formais** das stories em Ready for Review (1.2/1.3/1.4/1.6) — rodar @qa/@architect conforme `quality_gate` de cada story.
3. **CodeRabbit pre-PR** — autenticar a CLI e rodar antes do PR.
4. **E1 completo em implementação** — falta QA gates + consultoria jurídica externa (CJ-1…CJ-6 do checklist bloqueiam o piloto E10, não o dev).
5. **Caminho crítico do produto:** E1 → E2 (pipeline transcrição) → E3 (POC latência/custo). Os fakes da 1.6 destravam E3 antes da escolha de vendor.

## Regras de fronteira (resumo)
- `git push` / `gh pr create` / MCP = **@devops exclusivo**.
- @dev faz commit local, nunca push. Story status segue lifecycle `Draft→Ready→InProgress→Ready for Review→Done`.
- Docs de framework (`devLoadAlwaysFiles`: coding-standards/tech-stack/source-tree) **ainda não existem** — seguir padrões do código existente.
