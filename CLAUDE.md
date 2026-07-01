# NutriMed — Estado do Projeto

> Board de 3 especialistas de IA humanizados (voz+vídeo) para nutrólogos. Fosso = base
> clínica curada por persona, não o avatar. Postura regulatória: "IA assiste, médico decide".
> Stack: pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript · PGlite (dev) / Postgres (prod).

**📋 Registro completo do que foi construído: [`docs/IMPLEMENTATION-RECORD.md`](docs/IMPLEMENTATION-RECORD.md)**
(rastreabilidade FR/NFR/ADR, evidências ao vivo, decisões e pendências — fonte de verdade do status).

## Estado: EM PRODUÇÃO — https://nutrimed.fly.dev (2026-07-01)

**9 de 10 épicos com núcleo implementado e verificado ao vivo** (falta E8 — vídeos).
**E11 (Pacientes & Dashboard) COMPLETO** (4 fases + extras: faixa ideal/meta nos gráficos e
**Modo Apresentação** `/patients/[id]/apresentacao` — figura corporal paramétrica por IMC, régua
OMS e evolução) e **E12 (Bot de Telegram) COMPLETO** (9 stories) — bot **@RafaNutriBot** em
produção via webhook (visão real do Claude na foto do prato).
Suíte: **279 PASS (+1 skip)** · gates `lint`/`typecheck`/`test`/`build` todos PASS (24 pacotes).
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
de segurança, Modo Foco tecla F) → "▶ Consulta simulada" (STT roteirizado) ou "🎙️ Consulta ao vivo"
(mic real → WS `/audio` → Deepgram) → contribuições reais do **claude-haiku-4-5** auditadas →
síntese do Aurélio → nota clínica gerada/editável (cifrada+auditada) → telemetria (custo/gate/latência/ruído).

## Monorepo (24 pacotes)

```
apps/web                 Tela de consulta + ficha/dashboard + gateway WS + webhook do bot Telegram
packages/shared-types    Protocolo WS v1 (contribution/ping/transcript)
packages/domain          CLINICAL_VOCABULARY (boost STT)
packages/crypto          AES-256-GCM (NFR9)
packages/db              Migrations 0001–0006 · PGlite dev / pg prod (TLS)
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

1. **Teste de voz real do usuário** — plumbing pronto (falar e ver o board reagir).
2. **E8** — clipes ouvindo/pensando/sinalizando a partir de `apps/web/public/personas/*.png`
   (regenerar retratos: `node --env-file=.env scripts/gen-personas.mjs`).
3. **POCs formais** 2.5 (STT) e 3.4 (LLM) — keys já no `.env`; e **3.5/ADR-010** (runtime).
4. **QA gates formais** E2–E10 (E1 ✅ em `docs/qa/gates/`).
5. `AskDoctorInput` (FR14 completo) · dedup semântico · CodeRabbit pre-PR.
6. **Consultoria jurídica** CJ-1..CJ-6 (+**CJ-12** para o canal Telegram do paciente, E12)
   (`docs/architecture/project-decisions/checklist-consultoria-juridica.md`) — bloqueia o piloto com
   pacientes reais, não o dev.
7. 🔐 **Rotacionar TODAS as keys** (Anthropic/Deepgram/Gemini + **token do bot Telegram** — passaram
   pelo chat) antes de qualquer ambiente compartilhado.

## Avisos operacionais (lições pagas)

- **Next NÃO lê o `.env` da raiz** — keys de runtime em `apps/web/.env.local` (ambos gitignored).
- **NÃO rodar `npm run dev` com o token de PROD do bot** — o long-polling local faz `deleteWebhook`
  no boot e derruba o webhook de produção. Para dev do bot: criar um bot de teste no @BotFather.
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
