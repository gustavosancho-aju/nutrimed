# NutriMed — Estado do Projeto

> Board de 3 especialistas de IA humanizados (voz+vídeo) para nutrólogos. Fosso = base
> clínica curada por persona, não o avatar. Postura regulatória: "IA assiste, médico decide".
> Stack: pnpm workspaces · Next.js 16 + React 19 + Tailwind 4 · TypeScript · PGlite (dev) / Postgres (prod).

**📖 Documentação COMPLETA e atual do sistema: [`docs/documentacao-sistema.md`](docs/documentacao-sistema.md)**
(visão geral, arquitetura, 26 pacotes, modelo de dados, fluxos, integrações, segurança/compliance,
deploy e roadmap — a referência única do estado atual).
**📋 Registro histórico do MVP (E1–E10): [`docs/IMPLEMENTATION-RECORD.md`](docs/IMPLEMENTATION-RECORD.md)**
(rastreabilidade FR/NFR/ADR e evidências ao vivo do snapshot de 2026-06-11).

## Estado: EM PRODUÇÃO — https://nutrimed.fly.dev (2026-07-24, main)

**9 de 10 épicos com núcleo implementado e verificado ao vivo** (falta E8 — vídeos).
**E11 (Pacientes & Dashboard) COMPLETO** (4 fases + extras: faixa ideal/meta nos gráficos e
**Modo Apresentação** `/patients/[id]/apresentacao` — figura corporal paramétrica por IMC, régua
OMS e evolução) e **E12 (Bot de Telegram) COMPLETO** (9 stories) — bot **@RafaNutriBot** em
produção via webhook (visão real do Claude na foto do prato). **Bot em GRUPO (2026-07-11,
b8f533d, deployado e testado em prod):** grupo paciente+nutrólogo+nutricionista pareado como
canal do paciente; comandos aceitam `/comando@RafaNutriBot`; setup = privacy mode OFF no
@BotFather + re-adicionar o bot ao grupo + `/start CÓDIGO` no grupo (RUNBOOK passo 18c);
1 chat por paciente (grupo OU privado); dado clínico em chat coletivo reforça CJ-12.
**Água e sono pelo bot: REMOVIDOS (2026-07-24)** — decisão do Gustavo de manter o bot SIMPLES e
restrito à alimentação. A migration 0020 (`patient_self_log`), os serviços em `@nutrimed/patients`
(`addWaterLog`/`addSleepEvent`/…), as metas de água/sono na ficha e as colunas do dashboard
FICARAM (dado já coletado permanece visível; religar é só re-adicionar os handlers).
**Registro alimentar por TEXTO (2026-07-24):** `/comi 100g de arroz, 150g de frango` — parser
determinístico (`parseFoodText`) + tabela TACO, reusando `mapRecallToTaco`/`computeNutrition` do
E13: **sem visão e sem LLM nos números**, `source='telegram-texto'`, `model_version=taco-<versão>`.
Coexiste com a foto (o paciente escolhe caso a caso); com gramas explícitos a confiança nasce
`high` e o único ponto de incerteza que resta é o match na TACO (a foto chuta alimento E porção).
Porção não informada ⇒ assumida e SINALIZADA (`portionsEstimated`); item fora da TACO
(`unmatchedItems`) NÃO entra na conta. **Decisão de produto:** NÃO existe fila de conferência do
médico para o food log — autorrelato é aproximado por natureza e o gate de revisão médica já
existe onde importa (nota clínica e relatório E13 nascem como rascunho editável). O dashboard
sinaliza origem (📷/✍️), `~estimada` e itens fora da conta, e o médico pode **remover** um
registro errado (soft-delete, migration 0021 — a linha permanece para trilha/CJ-2).
**🔥 VAZAMENTO DE CUSTO CORRIGIDO (2026-07-24)** — picos de 1,3M→5M→4,8M tokens/dia (Haiku) nos
dias 22–24. Causa: o **case review** só exigia "estar em pausa natural"; numa consulta ABANDONADA
(aba esquecida aberta / sessão nunca parada) o silêncio eterno era lido como pausa permanente e o
review disparava a cada `caseReviewMs` PARA SEMPRE (~960 chamadas/dia por sessão órfã, sem ninguém
olhando). Correção em 3 camadas: (1) **teto de silêncio** `caseReviewIdleMs` (default 10 min) — sem
fala nova não há o que revisar, e quando a fala volta os reviews voltam; (2) **`idleStopMs`**
(default 60 min) — o board se desliga sozinho e chama `onIdleStop`; (3) **`onNoClients`** no gateway
+ `NO_CLIENT_GRACE_MS` (60s) no runtime — o último cliente WS sair derruba o board, com graça para
F5/troca de aba. Camada de "cenoura" (mesma rodada): **salvar a nota clínica encerra a sessão do board**
(`saveNoteAction` → `stopLiveBoard`, best-effort — falha NUNCA impede salvar; o `status` da consulta
NÃO muda, para não ligar o modo releitura antes do relatório E13) + **aviso `IdleConsultationBanner`**
na sala, que aparece só com sessão ativa + 5 min de silêncio (sem banner permanente, que brigaria
com a sala calma do E7). Decisão: NÃO bloquear o salvamento — travar registro clínico de consulta
interrompida é pior que sessão aberta, e não impediria o médico que fecha o notebook.
**Antes de reabrir o piloto: pôr limite de gasto por chave no Console** e separar
chaves prod/dev (hoje `.env` e `apps/web/.env.local` têm a MESMA chave, o que tornou o gráfico
ambíguo). Dívida relacionada fechada: `stopLiveBoardAction` sem parada por desconexão.
**Rodada Transcrição Confiável + Autonomia (PR #1, 2026-07-03):** erros de server action tipados
com mensagens pt-BR (`ActionResult`) · mimeType do MediaRecorder (Safari avisado) · status do
pipeline no WS + watchdog · **transcript persistido cifrado** (nota sobrevive a deploy; migration
0008) · painel 🩺 Diagnóstico · **WS pela MESMA porta do HTTP (443)** via `server.mjs` +
`BOARD_WS_MODE=attached` (dual-listen legado na 3001 durante a transição) · **autonomia dos
agentes**: histórico anti-repetição + `{"skip":true}`, dedup semântico (Jaccard, consulta inteira),
CaseState (memória estruturada do caso nas personas E na síntese), case review periódico (90s, só
em pausa) e telemetria `autonomy`. Code review pré-merge: 16 achados, 12 corrigidos (dívidas
restantes na memória do agente).
**E13 (Relatório Nutricional TACO) COMPLETO e em produção** (2026-07-04) e **Épico Transcrição
Confiável COMPLETO** (2026-07-04): (1) léxico clínico curado no boost do STT; (2) **revisão do
transcript pelo médico no fim da consulta** (migration 0010 `transcript_review`; a nota e o
relatório passam a nascer da versão corrigida); (3) POC 2.5 pronta (adapter escolhe `keyterm` no
nova-3 vs `keywords` no nova-2 + métricas de recall clínico + harness) — falta só o áudio real.
**Brief técnico jurídico** entregue (`docs/architecture/project-decisions/brief-tecnico-juridico.md`).
**E14 (Painel Laboratorial dinâmico) — IMPLEMENTADO, local (2026-07-27).** O laudo laboratorial
deixou de caber em 3 marcadores fixos + 3 slots: agora o PDF inteiro entra. Novo pacote
`@nutrimed/lab-catalog` (catálogo curado de ~80 exames com sinônimos — "TGP"/"ALT"/"transaminase
pirúvica" caem no MESMO slug, senão a série histórica se parte em duas linhas); exame fora do
catálogo entra como **analito livre** (`livre:<nome>`) — nada é descartado. **As faixas de
referência vêm do PRÓPRIO laudo** (`parseReferenceRange`), guardadas POR MEDIÇÃO: o NutriMed não
mantém faixa clínica própria (é do lab que assinou, já ajustada por sexo/idade, e muda com o tempo);
o parser remove qualificadores de IDADE antes de ler ("Maior que 20 anos: Superior a 40" ⇒ piso 40,
não 20). Intervalo fechado vira BANDA verde no gráfico; limite aberto vira LINHA pontilhada (banda
exigiria um piso que o laudo não deu). **Sem migration de dados**: o painel (`panel: LabAnalyte[]`)
entra no blob JSON já cifrado de `lab_exam.values_enc`; a migration 0022 guarda só a *seleção de
apresentação*. Os laudos imprimem "Evolução do paciente" (resultados anteriores) — o import traz
esse histórico, então a 1ª importação já nasce com LINHA de tendência em vez de um ponto solitário;
`planHistoryImport` é idempotente (reimportar o mesmo PDF não duplica pontos). **Guard de colisão**
(`resolveSlugCollisions`): dentro de um laudo um slug aparece UMA vez — o TTPA imprime 3 números
(plasma paciente 38,5s, controle 28,8s, relação 1,34) e o RFG 2 (adulto negro/não negro); sem o
guard virariam pontos incomparáveis na mesma série, com o "valor atual" sorteado pela ordem de
inserção. A 1ª ocorrência fica com o slug canônico, as demais viram exame livre com o nome do laudo.
**A aba Exames é uma LISTA, não uma parede de gráficos** (correção de rumo do Gustavo,
2026-07-28): a 1ª versão desenhava um gráfico por exame e 69 gráficos empilhados não deixam nada em
destaque. Agora é uma linha por exame (valor · faixa do laudo · dentro/fora · nº de medições ·
data), com busca, e o médico MARCA o que vira gráfico — o gráfico aparece na hora, sem salvar,
porque na consulta ele está explorando. Salvar persiste a seleção E a ordem, e é a MESMA seleção que
alimenta a Apresentação (teto de 12): duas listas separadas dobrariam o trabalho por uma distinção
que ninguém pediu. Sem seleção, a Apresentação não mostra exames (40 gráficos seriam ruído, e
escolher por ele seria decidir relevância clínica). **Extração REAL verificada** contra o laudo de 22 páginas do piloto
(`npx tsx --env-file=.env scripts/poc-lab-panel.mjs <laudo.pdf>`, ~US$ 0,09 no Haiku, 39s):
**70 analitos, 70/70 reconhecidos pelo catálogo, 66/70 com faixa interpretada, 31 com histórico**.
Foi essa rodada que revelou os 3 bugs corrigidos (colisão TTPA/RFG; tempo de protrombina mapeado
como atividade — 12,1s contra referência "> 70%"; glicemia média estimada fora do catálogo).
**Telas VERIFICADAS no navegador (2026-07-28)**, depois que a 0139ae1 derrubou o veto ao
`npm run dev`: aba Exames com os 69 analitos do laudo real agrupados por categoria, banda da faixa
desenhada e evolução ligando resultado antigo a novo; unificação das gerações confirmada (insulina
digitada no formulário de 3 campos e insulina do laudo na MESMA série); seleção com fila
reordenável persistindo a ordem; Apresentação obedecendo essa ordem; e a importação ponta a ponta
(tabela de confirmação → gravação → dashboard). Sem erro de console ou servidor.
Semear um laudo real localmente: `cd apps/web && npx tsx --env-file=.env.local
scripts/seed-laudo-real.mjs <laudo.pdf> ["Nome do paciente"]` (passa pelo MESMO caminho de código da
server action; extração cacheada ao lado do PDF — **o cache contém dado clínico, apague depois**).
Dívida conhecida: o modelo às vezes **copia a referência da linha vizinha** quando o laudo agrupa
grandezas sob um título só (o tempo de protrombina herdou o "> 70%" da atividade) — a tabela de
confirmação mostra a faixa interpretada justamente para o médico flagrar isso.
Suíte: **736 PASS (+1 skip)** · gates `lint`/`typecheck`/`test`/`build` todos PASS ·
CI GitHub (lint·typecheck·test·build, CodeQL, pnpm audit, gitleaks) verde. Migrations 0001–0022.
Deploy: Fly.io GRU (`flyctl deploy --remote-only -a nutrimed`) + Neon sa-east-1 · RUNBOOK Fase 5 = canal Telegram.

| Épico | Status | Épico | Status |
|---|---|---|---|
| E1 Fundação & Compliance | ✅ 100% Done + QA gates | E6 Board completo + Synthesizer | ✅ núcleo |
| E2 Pipeline de Transcrição | ✅ 5/6 (falta POC 2.5) | E7 UI do Board (+retratos Gemini) | ✅ núcleo |
| E3 Walking Skeleton + mic real | ✅ (faltam 3.4/3.5) | E8 Vídeo das Personas | ⬜ pendente |
| E4 Motores (gate/dedup/pausa) | ✅ núcleo | E9 Documentação Clínica | ✅ |
| E5 RAG namespaces + Reasoner | ✅ núcleo | E10 Observabilidade & Piloto | ✅ núcleo |
| E9 Documentação Clínica | ✅ | E11 Pacientes & Dashboard | ✅ completo (4 fases) |
| E12 Bot de Telegram (foto→nutrição vs metas) | ✅ completo (9 stories + grupo + texto; só alimentação) | E13 Relatório Nutricional (TACO) | ✅ completo (em produção) |
| E14 Painel Laboratorial dinâmico (laudo completo + apresentação) | ✅ implementado (local; falta verificar no navegador) | — | — |
| Transcrição Confiável (léxico + revisão do médico + POC) | ✅ completo (falta áudio real p/ POC) | — | — |

**Fluxo vivo:** login (`demo@nutrimed.test`/`nutrimed123`) → consulta → consentimento (default NEGA)
→ `/consultations/[id]`: transcrição AO VIVO + board (3 personas com retratos, feed com hierarquia
de segurança, Modo Foco tecla F) → "▶ Consulta simulada" (STT roteirizado; NÃO persiste transcript)
ou "🎙️ Consulta ao vivo" (mic real → WS `/audio` na porta da página → Deepgram; transcript persistido
cifrado) → contribuições reais do **claude-haiku-4-5** auditadas, com memória anti-repetição
(histórico + skip + dedup semântico + CaseState + case review 90s) → síntese do Aurélio →
**📝 revisão do transcript pelo médico** (Transcrição Confiável: corrige o que o STT ouviu; a
versão corrigida vira a fonte dos documentos) → nota
clínica gerada/editável (cifrada+auditada) → **🥗 Relatório Nutricional (E13)**: recordatório
extraído da transcrição pela IA, quantificado DETERMINISTICAMENTE pela tabela TACO embarcada
(591 alimentos, 4ª ed.), porções não ditas assumidas e SINALIZADAS "~estimada", itens sem match
sinalizados, delta vs meta do paciente (E11) quando vinculado — rascunho editável cifrado+auditado
com fontes TACO em kbSources → painel 🩺 Diagnóstico → telemetria (custo/gate/
latência/ruído/autonomia).

## Monorepo (28 pacotes)

```
apps/web                 Tela de consulta + ficha/dashboard + gateway WS + webhook do bot Telegram
packages/shared-types    Protocolo WS v1 (contribution/ping/transcript)
packages/domain          CLINICAL_VOCABULARY (boost STT, curado) + métricas de acurácia STT (recall clínico/WER — POC 2.5)
packages/crypto          AES-256-GCM (NFR9)
packages/db              Migrations 0001–0010 (0008 transcript cifrado · 0009 relatório nutricional · 0010 transcript revisado) · PGlite dev / pg prod (TLS)
packages/auth            scrypt + sessões DB-backed
packages/consent         Gate de gravação FR20 (servidor, default NEGA)
packages/audit           Trilha append-only com proveniência (NFR10)
packages/providers       4 interfaces NFR8 + fakes
packages/stt-deepgram    Adapter Deepgram (WS nativo, keywords)
packages/stt-openai      Adapter OpenAI Realtime (candidato B)
packages/llm-anthropic   Adapter Claude (Haiku default, longForm, onUsage)
packages/llm-kimi        Adapter Kimi/Moonshot (kimi-k3, 1M ctx, reasoning_effort low) — nota+relatório quando KIMI_API_KEY presente
packages/session         ConsultationSession (retry/backoff, gate 1.4)
packages/engines         E4: triggers + score/gate + rate-limit + dedup + pausa
packages/kb              E5: namespaces isolados + ingestão versionada + Reasoner
packages/board           E6: FullBoardOrchestrator (3 personas, síntese, divergência)
packages/board-gateway   WS autenticado /board + /audio
packages/clinical-notes  E9: nota cifrada+auditada + transcript persistido/revisado (Transcrição Confiável: saveTranscriptReview)
packages/telemetry       E10: custo/gate/latência/ruído + Quiet Board trigger
packages/patients        E11: paciente cifrado + medições (bioimpedância/exames) + computeAge
packages/lab-import      E11: extração de laudo PDF (ILabExtractor: Claude nativo + fake) — ADR-012
packages/food-vision     E12: estimativa nutricional por foto (IFoodEstimator: Claude visão + fake) — ADR-015
packages/telegram-link   E12: pareamento por código + gate de consentimento do canal (default NEGA) — ADR-013/014
packages/telegram-bot    E12: lógica pura do bot (handlers de foto/comandos + orientação por IA)
packages/taco            E13: tabela TACO 4ª ed. embarcada (591 alimentos) + busca lexical + porções caseiras (regen: scripts/gen-taco.mjs)
packages/nutrition-report E13: recordatório (LLM) → mapeamento TACO → cálculo determinístico → relatório cifrado+auditado
packages/lab-catalog     E14: catálogo canônico de exames (slug+sinônimos) + leitura da faixa de referência DO LAUDO — puro, sem faixa clínica própria
```

Comandos: `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run dev`.

## Pendências (ordem sugerida)

1. **Parecer jurídico (CJ-1..CJ-13)** — bloqueia o piloto com pacientes reais e o áudio real da
   POC 2.5. O **brief técnico** (`docs/architecture/project-decisions/brief-tecnico-juridico.md`)
   deixa a consultoria turnkey; falta o parecer de advogado + regras de negócio (retenção +
   captura do aceite do paciente). Não é dev.
2. **Rodar a POC 2.5** — código pronto (adapter keyterm + `scripts/poc-stt-score.mjs` + métricas
   em `@nutrimed/domain`). Falta o insumo: áudio clínico pt-BR (real consentido OU proxy TTS).
3. **Teste de voz real do médico** — plumbing pronto e endurecido: erros claros em pt-BR, painel
   🩺 Diagnóstico, WS na 443, personas sem repetição, transcrição revisável.
4. 🔐 **Rotação das keys** — Gustavo optou por NÃO rotacionar em 2026-07-04 ("confio no chat").
   Reavaliar antes de qualquer ambiente compartilhado/comercialização; trocar o token do bot no
   `apps/web/.env.local` por um bot de TESTE segue recomendado (incidente do webhook 2026-07-02).
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
- **Para VERIFICAR TELAS, o bot de teste NÃO é necessário (2026-07-28):** basta
  `TELEGRAM_MODE=webhook` no `.env.local`. Sem `PUBLIC_BASE_URL` (que não existe local), o runtime
  do Telegram fica **inerte** — não faz polling, não chama `deleteWebhook`, não registra webhook.
  Produção intocada. Foi o veto ao `npm run dev` que fez E14 e as fases 3–4 do E15 subirem sem
  ninguém olhar a tela; o bot de teste só é preciso para exercitar o BOT em si.
  Voltar ao polling (com bot de teste): trocar para `TELEGRAM_MODE=polling`.
- **Um dev server por diretório (Next 16)** — subir um segundo `next dev` em `apps/web` morre logo
  após o "Ready" com *"Another next dev server is already running"*, e o log some junto (o erro só
  aparece rodando em primeiro plano). Se o preview morrer sem explicação, procure o PID antigo.
- **PGlite não é compartilhável entre processos** — é Postgres DENTRO do processo. Um script que
  escreve no `.pgdata` enquanto o dev server roda **não é visto por ele** (cada um tem sua cópia em
  memória), e F5 não resolve. Ordem correta: parar o servidor → semear → subir o servidor.
- **Seed de 12 meses p/ verificar o histórico:**
  `cd apps/web && npx tsx --env-file=.env.local scripts/seed-plano-12-meses.mjs` — cria o paciente
  de teste com metas versionadas e ~560 lançamentos (adesão crescente ao longo do plano). Só banco
  LOCAL; produção usa Neon via `DATABASE_URL`, que não existe no `.env.local`.
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
