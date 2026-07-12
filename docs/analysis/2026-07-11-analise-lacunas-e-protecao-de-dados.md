# Análise do Sistema — Lacunas & Proteção de Dados

> **Analista:** Atlas (@analyst) · **Data:** 2026-07-11 · **Base:** main @ `cbee01e` (produção)
> Método: auditoria de código com evidência `arquivo:linha` (não só documentação), cruzada com
> `docs/documentacao-sistema.md`, `checklist-consultoria-juridica.md`, `brief-tecnico-juridico.md`,
> `docs/qa/gates/` e as 61 stories. Onde nada foi encontrado, está dito explicitamente.

---

## 1. Veredito executivo

O **núcleo de proteção de dados é sólido e acima da média para um MVP**: criptografia de campo
AES-256-GCM em todo dado clínico, trilha de auditoria imutável por trigger no banco, consentimento
default-NEGA em duas camadas (consulta + canal Telegram), TLS forçado, CI com gitleaks/CodeQL e
nenhum segredo versionado. A arquitetura de privacidade foi *pensada*, não improvisada.

As fragilidades são **específicas e endereçáveis**, mas duas são críticas **porque a produção já
contém dados de pacientes reais**:

1. 🔴 **CRÍTICO — Credencial pública dá acesso aos pacientes reais em produção.** A conta
   `demo@nutrimed.test` / `nutrimed123` é semeada sem guarda de `NODE_ENV`
   ([db.ts:16-38](../../apps/web/lib/db.ts)), a senha é **exibida na própria tela de login**
   ([login/page.tsx:65](../../apps/web/app/login/page.tsx)) — e é essa conta que o médico usa em
   produção com 5 pacientes reais. Qualquer pessoa com a URL entra e lê tudo.
2. 🔴 **ALTO — BOLA por `consultationId`**: várias server actions e 2 API routes checam apenas
   autenticação, não posse da consulta (detalhe em §3.2).

No plano de produto/processo, as lacunas estruturais são: sistema ainda **single-user sem cadastro
nem recuperação de senha**, **nenhum alerta de erro em produção**, **nenhuma política de
retenção/expurgo** (LGPD art. 18 / CJ-2) e **parecer jurídico pendente** — que segue sendo o
bloqueador formal do piloto.

---

## 2. Proteção de dados — o que está bem construído ✅

| Área | Evidência | Avaliação |
|---|---|---|
| Cripto em repouso | `packages/crypto/src/aes-gcm.ts:15-41` — AES-256-GCM, IV 12B aleatório por registro, auth tag validada (adulteração detectável) | ✅ Forte |
| Cobertura da cifra | 14 campos `_enc` nas migrations 0001–0011: nome/telefone/nascimento/objetivo do paciente, medições, exames, metas, transcrição (crua e revisada), nota clínica, relatório, sínteses, food log, exames custom | ✅ Todo conteúdo clínico cifrado |
| Chave | `DATA_ENCRYPTION_KEY` (32B base64) via env, falha cedo se ausente/errada em prod (`crypto-key.ts:11-20`) | ✅ |
| Senhas | scrypt + salt 16B + `timingSafeEqual` (`packages/auth/src/password.ts:11-24`) | ✅ (parâmetros default do Node) |
| Sessões | Token opaco 32B, só SHA-256 no banco, expiração 7d, cookie `httpOnly`+`secure`+`sameSite=lax` (`session.ts`, `auth-actions.ts:31-37`) | ✅ |
| Auditoria | Trigger `BEFORE UPDATE OR DELETE` que lança exceção (`migrations.ts:91-100`) — imutável no *banco*, não só na aplicação; escrita clínica + trilha na mesma transação (`audit.ts:90-107`) | ✅ Acima da média |
| Consentimento | Default NEGA no servidor (consulta: `consent.ts:56-59, 144-167`; canal Telegram: `link.ts:152-175`, código de pareamento = registro do consentimento, uso único, TTL 15min, revogável) | ✅ |
| Transporte | TLS obrigatório no Postgres com `rejectUnauthorized:true` (`connection.ts:37-43`), `force_https` no fly.toml | ✅ |
| Segredos | Nenhum secret em arquivo versionado (varredura + gitleaks no CI); `.env` gitignored | ✅ |
| Logs | Zero `console.*` nos packages; logs do web sem PII/conteúdo clínico; telemetria só contadores/latências | ✅ |
| WS | `/board` e `/audio` autenticados E escopados por posse da consulta (`gateway.ts:190-215`) | ✅ |
| Webhook Telegram | Valida `X-Telegram-Bot-Api-Secret-Token` (`webhook/route.ts:16-19`) | ✅ (mas condicional — ver §3.6) |

## 3. Proteção de dados — lacunas ❌⚠️

### 3.1 🔴 CRÍTICO — Credencial demo pública em produção com dados reais
- `seedDemoUser` roda em qualquer boot com `app_user` vazio, **sem guarda de ambiente**
  (`apps/web/lib/db.ts:16-38`); a tela de login **exibe** email+senha (`login/page.tsx:65`).
- Em `nutrimed.fly.dev` essa é a conta em uso pelo médico, com pacientes reais.
- **Correção mínima:** trocar a senha da conta em produção; condicionar o seed a
  `NODE_ENV !== 'production'`; remover a exibição das credenciais do login em prod.

### 3.2 🔴 ALTO — BOLA/IDOR no nível de consulta
Posse é checada no **paciente** (`assertOwner` em todas as actions de paciente) e no **WS**, mas
**não** nas operações por `consultationId` — um médico autenticado pode operar consulta de outro
conhecendo o UUID (não-enumerável, o que atenua mas não elimina):
- `consent-actions.ts:58-81` (conceder/revogar consentimento) · `note-actions.ts:31-74` (gerar/salvar nota)
- `nutrition-report-actions.ts:48-116` · `transcript-actions.ts:15-24` · `board-actions.ts:8-54`
- API routes `capture-authorization/route.ts:22-38` e `ui-telemetry/route.ts:25-33`
- **Correção:** helper `assertConsultationOwner` (`WHERE id=$1 AND user_id=$2`) em todos.

### 3.3 🔴 ALTO — Login sem defesas
Sem rate-limit, sem lockout, sem 2FA (`auth-actions.ts:13-39`; confirmado por varredura — o único
rate-limiter do repo é o de contribuições do board). Com credencial única e pública (§3.1), o
brute-force nem é necessário — mas segue lacuna após o fix.

### 3.4 🟡 MÉDIO — Sem headers de segurança HTTP
Sem CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy (`next.config.ts` sem
`headers()`, sem `middleware.ts`). `force_https` do Fly redireciona mas não emite HSTS.

### 3.5 🟡 MÉDIO — Retenção/exclusão inexistente (LGPD art. 18 / CJ-2)
Único `DELETE` do sistema é de sessão (`session.ts:49`). Não há como excluir paciente, consulta,
transcrição ou food log; nada expira. A migration 0008 passou a **persistir** a transcrição
cifrada, aumentando a superfície de retenção sem política de descarte. Depende da definição
jurídica (CJ-2), mas o *mecanismo* também não existe.

### 3.6 🟡 Menores (mas reais)
- **Backup/DR**: nada implementado/documentado no repo (Neon pode ter PITR — não verificado).
- **PII em claro**: `app_user.email`, `telegram_link.chat_id`, `food_log_entry.photo_ref` e
  todos os timestamps (padrões de refeição/consulta são metadado sensível).
- **Webhook Telegram**: validação do secret é condicional a `TELEGRAM_WEBHOOK_SECRET` estar
  setado — sem ele, aceita qualquer POST. Tornar obrigatório no boot de prod.
- **Token WS em query string** (`?token=` — `gateway.ts:186-188`): pode vazar em log de proxy.
- **Rotação de chaves adiada** (decisão de 2026-07-04, `CLAUDE.md`): reavaliar antes de qualquer
  ambiente compartilhado.
- **Auditoria**: imutabilidade é lógica (trigger) — superuser do Postgres contorna; hardening de
  permissões de DB é a Fase 2 do blueprint.

## 4. Lacunas funcionais e técnicas

### Produto
| Sev. | Lacuna |
|---|---|
| 🔴 | **Sem cadastro de médicos (signup) nem recuperação de senha** — sistema é single-user por seed. Bloqueia qualquer segundo usuário/comercialização. |
| 🟡 | **E8 (vídeo das personas)** — único épico do MVP não iniciado. |
| 🟡 | **Sem export/impressão PDF do dashboard** (a "Fase 4" do E11 era *import* de laudo, que foi feita). Apresentação não funciona offline nem tem folha de impressão. |
| 🟡 | **Import de laudo PDF não extrai exames personalizados** — whitelist fixa `ldl/hba1c/insulina` (`extractor.ts:14-17`); custom1..3 só entram manualmente (decisão consciente, mas agora que custom existe, vale reavaliar). |

### Técnico / Confiabilidade
| Sev. | Lacuna |
|---|---|
| 🔴 | **Sem validação de faixas plausíveis** — peso 900 kg ou negativo é aceito e persistido (`parseDecimal` só checa finitude). Risco clínico de dado absurdo em gráfico/relatório. |
| 🟡 | **Sem paginação em nenhuma lista** — pacientes, medições, histórico: `SELECT` sem LIMIT + decifra tudo em memória. Degrada com histórico longo. |
| 🟡 | **Edição concorrente = last-write-wins** — nota clínica, transcript revisado e relatório sem lock otimista (duas abas se sobrescrevem em silêncio). |
| 🔴 | **Nenhum alerta/APM em produção** — sem Sentry/equivalente; o `digest` do error.tsx exige alguém ler `flyctl logs` manualmente. O healthcheck reinicia queda dura mas não detecta taxa de erro. Ninguém fica sabendo dos erros (o print do médico é a prova). |

### Processo / QA
| Sev. | Lacuna |
|---|---|
| 🟡 | **Zero testes e2e** — CI só roda unit/lint/typecheck/build. Fluxos críticos verificados manualmente. |
| 🟡 | **Gates de QA formais só para E1** — E2..E13 sem gate; **31 stories paradas em "Ready for Review"**; E13, Transcrição Confiável e Modo Apresentação foram a produção **sem story**. Rastreabilidade FR/NFR incompleta. |
| 🟡 | **POCs 2.5 (STT), 3.4 (LLM/carga) e 3.5 (runtime)** nunca rodadas — validação de NFR5 pendente antes do piloto. |
| ⚪ | `shared-types` é o único pacote sem teste (baixo risco). |

## 5. Jurídico / Compliance (estado)

- **Brief técnico pronto** (`brief-tecnico-juridico.md`): inventário de dados, transferências
  internacionais (Deepgram/Anthropic/Telegram/Gemini), segurança — insumo turnkey p/ advogado.
- **Parecer NÃO existe** — CJ-1..CJ-6 (base legal, retenção, transferência, CFM 2.314, termos,
  consentimento do paciente) + **CJ-12** (Telegram, agravado pelo modo grupo) **bloqueiam o
  piloto com pacientes reais**. CJ-7..CJ-11, CJ-13 são importantes mas não bloqueantes.
- ⚠️ **Observação factual desta análise**: a produção **já contém dados de pacientes reais**
  (nomes, telefone, exames, fotos de prato via Telegram) *antes* do parecer — combinado com §3.1,
  isso merece decisão consciente do dono do produto.

## 6. Priorização recomendada

| # | Ação | Esforço | Urgência |
|---|---|---|---|
| 1 | Fechar §3.1: senha nova em prod + seed com guarda + remover creds do login | Horas | **Imediata** |
| 2 | `assertConsultationOwner` nas actions/rotas de §3.2 | Horas | Semana |
| 3 | Rate-limit no login + headers de segurança (CSP/HSTS/XFO) | Horas–1d | Semana |
| 4 | Alerta de erro em produção (Sentry free tier ou webhook p/ Telegram do dono) | Horas | Semana |
| 5 | Validação de faixas clínicas plausíveis nos forms/import | Horas | Semana |
| 6 | Parecer jurídico CJ-1..CJ-6 + CJ-12 (não é dev; brief pronto) | Externo | Bloqueia piloto |
| 7 | Política + mecanismo de retenção/expurgo (depende do CJ-2) | Dias | Pós-parecer |
| 8 | Signup + reset de senha (multi-médico) | Dias | Pré-comercialização |
| 9 | Rotação de chaves + backup documentado + e2e mínimo + fechar stories/gates | Dias | Contínuo |

---
*Fontes: auditoria de código com evidências linha a linha (2 varreduras independentes),
`docs/documentacao-sistema.md`, `docs/architecture/production-security-blueprint.md`,
`docs/architecture/project-decisions/checklist-consultoria-juridica.md` e `brief-tecnico-juridico.md`.*
