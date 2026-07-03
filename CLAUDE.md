# NutriMed — Estado do Projeto

> Board de 3 especialistas de IA humanizados (voz+vídeo) para nutrólogos. Fosso = base
> clínica curada por persona, não o avatar. Postura regulatória: "IA assiste, médico decide".
> Stack: pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript · PGlite (dev) / Postgres (prod).

**📋 Registro completo do que foi construído: [`docs/IMPLEMENTATION-RECORD.md`](docs/IMPLEMENTATION-RECORD.md)**
(rastreabilidade FR/NFR/ADR, evidências ao vivo, decisões e pendências — fonte de verdade do status).

## Estado: EM PRODUÇÃO — https://nutrimed.fly.dev (2026-07-03, main @ PR #1)

**9 de 10 épicos com núcleo implementado e verificado ao vivo** (falta E8 — vídeos).
**E11 (Pacientes & Dashboard) COMPLETO** (4 fases + extras: faixa ideal/meta nos gráficos e
**Modo Apresentação** `/patients/[id]/apresentacao` — figura corporal paramétrica por IMC, régua
OMS e evolução) e **E12 (Bot de Telegram) COMPLETO** (9 stories) — bot **@RafaNutriBot** em
produção via webhook (visão real do Claude na foto do prato).
**Rodada Transcrição Confiável + Autonomia (PR #1, 2026-07-03):** erros de server action tipados
com mensagens pt-BR (`ActionResult`) · mimeType do MediaRecorder (Safari avisado) · status do
pipeline no WS + watchdog · **transcript persistido cifrado** (nota sobrevive a deploy; migration
0008) · painel 🩺 Diagnóstico · **WS pela MESMA porta do HTTP (443)** via `server.mjs` +
`BOARD_WS_MODE=attached` (dual-listen legado na 3001 durante a transição) · **autonomia dos
agentes**: histórico anti-repetição + `{"skip":true}`, dedup semântico (Jaccard, consulta inteira),
CaseState (memória estruturada do caso nas personas E na síntese), case review periódico (90s, só
em pausa) e telemetria `autonomy`. Code review pré-merge: 16 achados, 12 corrigidos (dívidas
restantes na memória do agente).
Suíte: **377 PASS (+1 skip)** · gates `lint`/`typecheck`/`test`/`build` todos PASS (24 pacotes) ·
CI GitHub (lint·typecheck·test·build, CodeQL, pnpm audit, gitleaks) verde.
Deploy: Fly.io GRU (`flyctl deploy --remote-only -a nutrimed`) + Neon sa-east-1 · RUNBOOK Fase 5 = canal Telegram.

| Épico | Status | Épico | Status |
|---|---|---|---|
| E1 Fundação & Compliance | ✅ 100% Done + QA gates | E6 Board completo + Synthesizer | ✅ núcleo |
| E2 Pipeline de Transcrição | ✅ 5/6 (falta POC 2.5) | E7 UI do Board (+retratos Gemini) | ✅ núcleo |
| E3 Walking Skeleton + mic real | ✅ (faltam 3.4/3.5) | E8 Vídeo das Personas | ⬜ pendente |
| E4 Motores (gate/dedup/pausa) | ✅ núcleo | E9 Documentação Clínica | ✅ |
| E5 RAG namespaces + Reasoner | ✅ núcleo | E10 Observabilidade & Piloto | ✅ núcleo |
| E9 Documentação Clínica | ✅ | E11 Pacientes & Dashboard | ✅ completo (4 fases) |
| E12 Bot de Telegram (foto→nutrição vs metas) | ✅ completo (9 stories) | — | — |

**Fluxo vivo:** login (`demo@nutrimed.test`/`nutrimed123`) → consulta → consentimento (default NEGA)
→ `/consultations/[id]`: transcrição AO VIVO + board (3 personas com retratos, feed com hierarquia
de segurança, Modo Foco tecla F) → "▶ Consulta simulada" (STT roteirizado; NÃO persiste transcript)
ou "🎙️ Consulta ao vivo" (mic real → WS `/audio` na porta da página → Deepgram; transcript persistido
cifrado) → contribuições reais do **claude-haiku-4-5** auditadas, com memória anti-repetição
(histórico + skip + dedup semântico + CaseState + case review 90s) → síntese do Aurélio → nota
clínica gerada/editável (cifrada+auditada) → painel 🩺 Diagnóstico → telemetria (custo/gate/
latência/ruído/autonomia).

## Monorepo (24 pacotes)

```
apps/web                 Tela de consulta + ficha/dashboard + gateway WS + webhook do bot Telegram
packages/shared-types    Protocolo WS v1 (contribution/ping/transcript)
packages/domain          CLINICAL_VOCABULARY (boost STT)
packages/crypto          AES-256-GCM (NFR9)
packages/db              Migrations 0001–0008 (0007 sínteses · 0008 transcript cifrado) · PGlite dev / pg prod (TLS)
packages/auth            scrypt + sessões DB-backed
packages/consent         Gate de gravação FR20 (servidor, default NEGA)
packages/audit           Trilha append-only com proveniência (NFR10)
packages/providers       4 interfaces NFR8 + fakes
packages/stt-deepgram    Adapter Deepgram (WS nativo, keywords)
packages/stt-openai      Adapter OpenAI Realtime (candidato B)
packages/llm-anthropic   Adapter Claude (Haiku default, longForm, onUsage)
packages/session         ConsultationSession (retry/backoff, gate 1.4)
packages/engines         E4: triggers + score/gate + rate-limit + dedup + pausa
packages/kb              E5: namespaces isolados + ingestão versionada + Reasoner
packages/board           E6: FullBoardOrchestrator (3 personas, síntese, divergência)
packages/board-gateway   WS autenticado /board + /audio
packages/clinical-notes  E9: nota cifrada+auditada
packages/telemetry       E10: custo/gate/latência/ruído + Quiet Board trigger
packages/patients        E11: paciente cifrado + medições (bioimpedância/exames) + computeAge
packages/lab-import      E11: extração de laudo PDF (ILabExtractor: Claude nativo + fake) — ADR-012
packages/food-vision     E12: estimativa nutricional por foto (IFoodEstimator: Claude visão + fake) — ADR-015
packages/telegram-link   E12: pareamento por código + gate de consentimento do canal (default NEGA) — ADR-013/014
packages/telegram-bot    E12: lógica pura do bot (handlers de foto/comandos + orientação por IA)
```

Comandos: `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run dev`.

## Pendências (ordem sugerida)

1. **Teste de voz real do médico** — plumbing pronto e endurecido: erros claros em pt-BR, painel
   🩺 Diagnóstico, WS na 443 (rede de clínica ok), personas sem repetição. Checklist E2E no plano
   `~/.claude/plans/fa-a-uma-revis-o-completa-effervescent-puppy.md` §Verificação.
2. 🔐 **Rotacionar TODAS as keys** (Anthropic/Deepgram/Gemini + **token do bot Telegram** — passaram
   pelo chat) e **trocar o token do `apps/web/.env.local` por um bot de TESTE** (hoje é o de prod —
   causou o incidente do webhook em 2026-07-02).
3. **Dívidas do code review do PR #1** (não bloqueiam): stopLiveBoardAction com retorno ignorado no
   stop(); case review cego a seenTopics/divergência FR7; threshold 0.5 do dedup e knobs
   (caseReviewMs etc.) sem config/env; helper único p/ strip de cercas ```json (5 cópias) e
   fromPglite de teste (16 cópias); concurrency do fly (200/250) a calibrar na POC 3.4;
   `isStaleDeployError` por string do Next; remover dual-listen da 3001 após a transição.
4. **E8** — clipes ouvindo/pensando/sinalizando a partir de `apps/web/public/personas/*.png`
   (regenerar retratos: `node --env-file=.env scripts/gen-personas.mjs`).
5. **POCs formais** 2.5 (STT) e 3.4 (LLM/carga) — keys já no `.env`; e **3.5/ADR-010** (runtime).
6. **QA gates formais** E2–E10 (E1 ✅ em `docs/qa/gates/`).
7. `AskDoctorInput` (FR14 completo) · CodeRabbit pre-PR (limite de 150 arquivos por PR).
8. **Consultoria jurídica** CJ-1..CJ-6 (+**CJ-12** Telegram; +**CJ-2** retenção do transcript
   persistido pela migration 0008)
   (`docs/architecture/project-decisions/checklist-consultoria-juridica.md`) — bloqueia o piloto com
   pacientes reais, não o dev.

## Avisos operacionais (lições pagas)

- **Next NÃO lê o `.env` da raiz** — keys de runtime em `apps/web/.env.local` (ambos gitignored).
- **NÃO rodar `npm run dev` com o token de PROD do bot** — o long-polling local faz `deleteWebhook`
  no boot e derruba o webhook de produção (aconteceu em 2026-07-02). Para dev do bot: criar um bot
  de teste no @BotFather. Guards no código: polling é RECUSADO se o token já tem webhook ativo
  (`getWebhookInfo`) e IGNORADO com `NODE_ENV=production` — mas o bot de teste continua obrigatório.
- **WS em produção = MESMA porta do HTTP (443)** — `BOARD_WS_MODE=attached` + `apps/web/server.mjs`
  (CMD do Dockerfile). Dev local segue `next dev` + gateway na 3001. Rollback: `BOARD_WS_MODE=port`
  + CMD `next start`. Listener legado na 3001 ativo só na transição.
- **"▶ Consulta simulada" NÃO persiste transcript** (de propósito): o script fictício contaminaria
  a nota clínica da consulta real.
- **Mudou gateway/runtime/migrations? REINICIE o `npm run dev`** — singletons globais ignoram HMR;
  PGlite só aplica migration nova no boot.
- **Nunca usar heredoc bash com backticks/template literals** — escrever script `.cjs` e executar.
- `api.github.com` é **bloqueado nesta rede** → `gh` CLI não funciona; push via SSH porta 443
  (`~/.ssh/config` → `ssh.github.com:443`). PRs só pela web UI.
- Push exige `AIOX_ACTIVE_AGENT=github-devops git push` (hook de fronteira).

## Regras de fronteira (resumo)

- `git push` / PR / MCP = **@devops exclusivo**. @dev commita local, nunca push.
- Story lifecycle: `Draft→Ready→InProgress→Ready for Review→Done` (stories em `docs/stories/`).
- Decisões de arquitetura: ADR-001..009 (`docs/architecture.md` §10 + `docs/architecture/project-decisions/`).
