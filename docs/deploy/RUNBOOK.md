# RUNBOOK de Deploy — NutriMed (Fly.io · região GRU)

| Campo | Valor |
|---|---|
| **Status** | Pacote de deploy preparado (artefatos criados). NENHUM recurso provisionado, NENHUM deploy feito. |
| **Autor** | Gage (@devops) |
| **Data** | 2026-06-14 |
| **Âncoras** | [ADR-010](../architecture/project-decisions/adr-010-runtime-producao.md) (runtime), [ADR-009](../architecture/project-decisions/adr-009-residencia-dados-br.md) (residência BR), [Blueprint de Segurança](../architecture/production-security-blueprint.md) |

> **Quem executa:** VOCÊ (o usuário). Este documento é literal e numerado. @devops preparou os
> arquivos; o provisionamento real e o `flyctl deploy` são manuais. Siga as fases NA ORDEM.
>
> **Rede:** `api.github.com` é bloqueado nesta rede → o `gh` CLI não funciona aqui; push é manual
> via SSH (porta 443). O `flyctl` fala com `api.fly.io` (não com o GitHub) — funciona normalmente.

---

## ✅ Bloqueador conhecido — RESOLVIDO (mitigação #1 aplicada)

> **Status: RESOLVIDO em 2026-06-14 (@dev).** Aplicada a **mitigação #1** (warm-up no boot via
> `instrumentation.ts`). Arquivo: `apps/web/instrumentation.ts` — o hook `register()` chama
> `getBoardRuntime()` no startup do servidor (guard `NEXT_RUNTIME === 'nodejs'`, import dinâmico do
> módulo `server-only`, try/catch que não derruba o boot). A porta 3001 agora sobe **junto com o
> Next**, não mais preguiçosamente na primeira consulta. O lazy-start em `getBoardRuntime()`
> permanece como fallback (a chamada é idempotente — singleton). O texto abaixo descreve o problema
> original e fica como histórico.

O gateway WebSocket do board (`/board` e `/audio`, porta `BOARD_WS_PORT=3001`) vive **dentro** do
processo do Next (ADR-010), mas era inicializado de forma **preguiçosa**: o singleton
`globalThis.__nutrimedBoard` só era criado quando `getBoardRuntime()` era chamado pela primeira vez —
o que acontecia **na primeira renderização de uma página de consulta**
(`apps/web/app/consultations/[id]/page.tsx`, linha ~35).

**Consequência:** logo após o `next start`, a porta 3001 **ainda não está escutando**. Ela só passa
a aceitar conexões depois que alguém abre uma consulta. Isso afeta:
- o **healthcheck TCP da porta 3001** no `fly.toml` (pode falhar até a primeira consulta);
- o **primeiro cliente** que tentar conectar ao WS antes de a porta abrir.

**Mitigações (escolha uma — decisão de @dev/@architect, não bloqueia este pacote):**
1. **Warm-up no boot (recomendado):** adicionar um custom entrypoint/`instrumentation.ts` que chame
   `getBoardRuntime()` no startup do servidor, garantindo que a porta 3001 suba junto com o Next.
   É a correção limpa e mantém o single-process do ADR-010.
2. **Aceitar lazy-start na Fase 1 (piloto/instância única):** o healthcheck que importa é o HTTP
   (porta 3000, `/login`) — esse funciona desde o boot. O `fly.toml` usa `tcp_checks` com
   `grace_period` longo na 3001 para tolerar o atraso. O primeiro acesso a uma consulta sobe o WS.

> **AUTO-DECISION:** mantive o healthcheck **HTTP na 3000** como o gate de saúde principal (sobe no
> boot) e deixei o check TCP da 3001 tolerante. Razão: o pacote de infra não deve inventar código de
> runtime (Article IV). A mitigação #1 é uma story de @dev, registrada como pendência abaixo.

---

## Fase 0 — Perímetro de segurança (BLOQUEANTE, antes de qualquer ambiente compartilhado)

> Blueprint §9 Fase 0. **Nada de deploy antes disto.**

1. **🔐 ROTACIONAR TODAS as keys que passaram pelo chat** (CLAUDE.md pendência #7 — tratar como
   credenciais comprometidas):
   - **Anthropic** (`ANTHROPIC_API_KEY`): console.anthropic.com → API Keys → revogar a antiga, gerar nova.
   - **Deepgram** (`DEEPGRAM_API_KEY`): console.deepgram.com → API Keys → revogar antiga, gerar nova.
   - **Gemini** (`GEMINI_API_KEY`, usada só por `scripts/gen-personas.mjs`, geração de retratos — NÃO
     é runtime de produção): aistudio.google.com → revogar antiga, gerar nova.
2. **Gerar a chave de criptografia em repouso** (`DATA_ENCRYPTION_KEY`, NFR9 — base64 de 32 bytes):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Guarde no cofre; **NUNCA** no `.env` de servidor, **NUNCA** junto dos backups (ADR-009 Decisão 4).
3. **Confirmar que nenhuma key viva está no repo:** o workflow `secret-scan` (gitleaks) roda no CI;
   rode também localmente se quiser. Se aparecer key no histórico, rotacione-a também.

---

## Fase 1 — Conta Fly e preparação local

4. **Criar conta Fly** em https://fly.io e instalar o `flyctl`:
   - Windows (PowerShell): `iwr https://fly.io/install.ps1 -useb | iex`
   - Verifique: `flyctl version`
5. **Login:** `flyctl auth login` (abre o browser).
6. **`fly launch` SEM DEPLOY** — a partir da raiz do repo (onde estão `Dockerfile` e `fly.toml`):
   ```bash
   flyctl launch --no-deploy --copy-config --region gru
   ```
   - `--copy-config` usa o `fly.toml` já preparado (não deixe ele sobrescrever).
   - `--region gru` força São Paulo (ADR-009).
   - Se ele perguntar sobre criar Postgres agora, **responda NÃO** (provisionamos no passo seguinte
     com decisão consciente de residência).

---

## Fase 2 — Postgres em região BR + migrations

> ADR-009: dados duráveis no BR. `packages/db` exige TLS em conexões remotas
> (`ssl.rejectUnauthorized = true`; `sslmode=disable` é proibido).

### Recomendação de provedor (com justificativa)

| Opção | Residência BR | TLS público válido | Recomendação |
|---|---|---|---|
| **Fly Postgres (região gru)** | ✅ gru | ⚠️ conexão interna via `.flycast`/`.internal` (WireGuard) pode não ter cert de CA pública → conflita com `rejectUnauthorized: true` | Possível, mas exige cuidado com TLS (ver nota abaixo) |
| **Neon (região AWS sa-east-1 / São Paulo)** | ✅ sa-east-1 | ✅ cert público válido, `sslmode=require` | **RECOMENDADO** — TLS "simplesmente funciona" com o código atual, residência BR, gerenciado |
| **Supabase (região South America / São Paulo)** | ✅ | ✅ cert público válido | Alternativa equivalente ao Neon |

> **AUTO-DECISION:** recomendo **Neon (ou Supabase) em região São Paulo** em vez do Fly Postgres.
> Razão: o código força `ssl.rejectUnauthorized = true` (`packages/db/src/connection.ts`); um
> Postgres com **cert de CA pública** (Neon/Supabase) satisfaz isso sem alterar código. O Fly Postgres
> interno usa rede privada cujo certificado pode não validar contra CAs públicas, exigindo passar um
> CA custom — fricção desnecessária na Fase 1. Ambos cumprem ADR-009 (residência BR). Decisão final
> é do @architect; ADR-009 não amarra o provedor, só a região.

7. **Provisionar o Postgres** no provedor escolhido, **em região São Paulo / sa-east-1**, com TLS.
   Anote a connection string (formato `postgres://USER:PASS@HOST:5432/DB?sslmode=require`).
8. **Migrations 0001–0004:** são aplicadas **automaticamente** no primeiro acesso ao banco
   (`getDb()` → `runMigrations`, idempotente, rastreadas em `_migrations`). Você NÃO precisa de um
   comando separado — o primeiro boot que tocar o DB aplica tudo. **Para verificar** após o 1º deploy:
   conecte com `psql "<DATABASE_URL>"` e rode `SELECT name FROM _migrations ORDER BY name;` —
   deve listar as 4 migrations.

---

## Fase 3 — Secrets de runtime no Fly

> Blueprint §2: **nunca `.env` em servidor de produção.** Tudo via `fly secrets`. O `fly.toml` só
> tem variáveis não-sensíveis (portas, NODE_ENV, URL pública do WS).

9. **Setar os secrets** (lista EXATA extraída do código — `grep process.env`):
   ```bash
   flyctl secrets set \
     DATABASE_URL="postgres://USER:PASS@HOST:5432/nutrimed?sslmode=require" \
     ANTHROPIC_API_KEY="<nova-key-rotacionada>" \
     DEEPGRAM_API_KEY="<nova-key-rotacionada>" \
     DATA_ENCRYPTION_KEY="<base64-32-bytes-do-passo-2>"
   ```
   - `BOARD_WS_PORT` e `PORT` já vêm do `[env]` do `fly.toml` (não são segredos) — não precisa setar.
   - `NEXT_PUBLIC_BOARD_WS_URL` está no `[env]` do `fly.toml`; **ajuste o domínio** para o do seu app
     real (ex.: `wss://nutrimed.fly.dev:3001`). É variável `NEXT_PUBLIC_*` → vai ao browser, **não é
     segredo**, por isso fica no `fly.toml` e não em `secrets`.
   - `GEMINI_API_KEY` **NÃO** entra no runtime — é só do script de geração de retratos (offline).

---

## Fase 4 — Primeiro deploy e verificação

10. **Deploy** (a partir da raiz):
    ```bash
    flyctl deploy --remote-only
    ```
    Ou, via GitHub Actions: crie o secret de repositório `FLY_API_TOKEN`
    (`flyctl tokens create deploy`) e dispare o workflow **Deploy (Fly.io · GRU)** manualmente
    (aba Actions → Run workflow) ou empurrando uma tag `vX.Y.Z`.
11. **Verificar saúde:**
    - `flyctl status` → máquina `started`, healthcheck HTTP `passing`.
    - `flyctl logs` → procure o boot do Next sem erros de `DATABASE_URL`/`DATA_ENCRYPTION_KEY`
      (ambos falham cedo e claro se ausentes/ inválidos).
    - Abra `https://<seu-app>.fly.dev/login` → tela de login deve renderizar.
12. **Verificar migrations** (Fase 2, passo 8): `psql "<DATABASE_URL>" -c "SELECT name FROM _migrations ORDER BY name;"`.
13. **Teste de voz real fim-a-fim** (pendência #1 do projeto):
    - Login → criar/abrir consulta → **conceder consentimento** (default NEGA, FR20).
    - O WS na 3001 já sobe no boot via `instrumentation.ts` (Bloqueador RESOLVIDO acima); abrir uma
      consulta apenas reusa o singleton já inicializado.
    - "🎙️ Consulta ao vivo" → falar ao microfone → confirmar que o board reage (Deepgram → orquestrador
      → contribuições do Claude → síntese → nota clínica).
    - Conferir no `flyctl logs` que **nenhum conteúdo clínico** é logado (Blueprint §7 — só IDs/latências).

---

## Fase 5 — Canal Telegram do paciente (E12, opcional)

> Bot único (mesmo para todos os pacientes): foto do prato → estimativa nutricional vs. metas.
> Transporte por webhook **entra na porta 3000 já exposta** (sem nova porta/processo — ADR-010);
> `fly.toml`/`Dockerfile` **não mudam**. 🚫 **Gate CJ-12** (checklist jurídico): o canal **não vai ao
> ar com pacientes reais** sem parecer — o dev/testes com `FOOD_ESTIMATOR=fake` não dependem disto.

14. **🔐 Rotacionar o token do bot** se ele passou por chat/log (Fase 0): `@BotFather` → `/revoke` →
    gerar novo. Escolha também um **secret de webhook** forte (string aleatória, ex.:
    `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`).
15. **Secrets de runtime** (sensíveis → `fly secrets`, nunca no `fly.toml`):
    ```bash
    flyctl secrets set \
      TELEGRAM_BOT_TOKEN="<token-do-BotFather>" \
      TELEGRAM_WEBHOOK_SECRET="<hex-aleatorio-do-passo-14>"
    ```
    - `ANTHROPIC_API_KEY` (já setada na Fase 3) serve à **visão da foto** e à orientação por IA.
16. **Variáveis não-sensíveis** no `[env]` do `fly.toml` (vão ao runtime, não são segredo):
    - `TELEGRAM_MODE=webhook`
    - `PUBLIC_BASE_URL=https://<seu-app>.fly.dev` (base do `setWebhook`)
    - `FOOD_ESTIMATOR` — **deixe em branco em prod** para usar a visão real do Claude; ou `fake` para
      desligar a estimativa (sem custo) enquanto o canal não estiver liberado.
17. **Registro do webhook é automático no boot** (`instrumentation.ts` → `getTelegramRuntime()` →
    `setWebhook(PUBLIC_BASE_URL + /api/telegram/webhook, secret_token)`, idempotente). **Verificar:**
    ```bash
    curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
    ```
    deve mostrar a `url` do seu app e `pending_update_count` baixo, sem `last_error_message`.
18. **Teste fim-a-fim:** na ficha do paciente → "Assistente no Telegram" → **Gerar código** e definir
    **metas**; o paciente envia `/start CÓDIGO` ao bot, depois a **foto do prato** → recebe a estimativa
    vs. meta. Confira `flyctl logs`: aparece `[telegram] foto processada — pacientes ativos: N, custo de
    visão acumulado ~US$X` e **nenhum conteúdo clínico/PII** (NFR9 — só contadores/custo).
19. **Rollback do canal:** para desligar o webhook (sem afetar o resto do app):
    ```bash
    curl -s "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
    ```
    e remova/zere `TELEGRAM_BOT_TOKEN` nos secrets (o runtime vira no-op sem token).

---

## Fica para depois (com ponteiros — não bloqueia o primeiro deploy técnico)

> Blueprint §9, Fases 2–4. Ordem sugerida.

- ✅ ~~**Warm-up do WS no boot** (mitigação #1 do Bloqueador) — story de @dev.~~ **RESOLVIDO em
  2026-06-14** via `apps/web/instrumentation.ts` (hook `register()` chama `getBoardRuntime()` no boot).
- **CDN / WAF / TLS edge** com sticky por `consultationId` e rate-limit/DDoS — Blueprint §1 e §9 Fase 2.
- **Hardening de auth:** rate-limit de login, política de sessão, **MFA para médicos** — Blueprint §4.
- **Auditoria imutável** (permissões de DB vedando UPDATE/DELETE) — Blueprint §5.
- **Observabilidade:** logs estruturados sem PII + **Sentry com scrubbing** — Blueprint §7.
- **Graceful drain refinado** (sinal de shutdown para de aceitar novas consultas) — ADR-010 Decisão 4.
- **🚫 GATE JURÍDICO DO PILOTO:** nenhum paciente real antes de **CJ-1..CJ-6**
  (`docs/architecture/project-decisions/checklist-consultoria-juridica.md`) — Blueprint §8/§9 Fase 3.
  As Fases 1–2 deste runbook podem estar tecnicamente prontas e **ainda assim** o piloto não inicia.

---

## Rollback rápido

- `flyctl releases` → lista as releases. `flyctl deploy --image <imagem-anterior>` ou
  `flyctl releases rollback` para voltar. Lembre: rollback **derruba sessões vivas** (estado em
  memória não migra, ADR-010) — agende em janela de baixa atividade.
