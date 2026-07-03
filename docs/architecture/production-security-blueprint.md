# Blueprint de Arquitetura Segura de Produção — NutriMed

| Campo | Valor |
|---|---|
| **Status** | Direção de arquitetura (caminho MVP-local → plataforma pronta para escrutínio de saúde) |
| **Data** | 2026-06-14 |
| **Autor** | Aria (@architect) |
| **Fontes** | NFR9 (cripto repouso/trânsito), NFR10 (auditoria/IA assistiva), FR20 (consentimento), R1/R2 (riscos CFM/LGPD); [ADR-009](project-decisions/adr-009-residencia-dados-br.md) (região BR), [ADR-010](project-decisions/adr-010-runtime-producao.md) (runtime), ADR-002 (abstração fornecedores), ADR-006 (compliance-by-design); [checklist-consultoria-juridica.md](project-decisions/checklist-consultoria-juridica.md) (CJ-1..CJ-10); CLAUDE.md (estado MVP, keys vazadas) |

> **Convenção de rastreabilidade (Article IV — No Invention):** cada item ou âncora-se a um requisito/ADR existente, ou está marcado **[REC]** = recomendação de arquitetura (decisão nova a validar), ou **[GAP]** = lacuna conhecida sem infra hoje.

## Premissa e estado atual

NutriMed trata **dados sensíveis de saúde** (LGPD art. 11) sob a postura "IA assiste, médico decide" (CFM). O MVP funciona **apenas localmente**: **não há Dockerfile, vercel.json nem IaC** — não existe infraestrutura de produção. Já existem, no código: cripto AES-256-GCM (NFR9), trilha de auditoria append-only (NFR10), consentimento server-side default-NEGA (FR20), auth scrypt+sessões DB, e telemetria (E10). Este blueprint descreve o caminho do estado atual até produção defensável.

---

## 1. Topologia de deploy

Coerente com ADR-010 (servidor Node long-lived, **não** serverless) e ADR-009 (tudo durável no BR).

```
                                  ┌─────────── Região BR ───────────────────────────┐
                                  │                                                  │
 [ Navegador do médico ]          │   ┌──────────────────────────────┐              │
   - HTTPS (app)                  │   │  Node Server (long-lived)      │              │
   - WSS /board  (eventos)  ──────┼──▶│  Next.js 16 + BoardGateway     │              │
   - WSS /audio  (mic real) ──────┤   │  (mesmo processo, ADR-010)     │              │
        │                         │   │  estado de sessão EM MEMÓRIA   │              │
        ▼                         │   │  (Map por consultationId)      │              │
 [ CDN + WAF + TLS term. ]        │   └───────┬──────────────┬─────────┘              │
   - sticky por consultationId    │           │ TLS          │ TLS                    │
   - rate-limit / DDoS            │           ▼              ▼                        │
   - (WSS deve passar pelo WAF)   │   ┌──────────────┐  ┌──────────────┐             │
                                  │   │ Postgres BR  │  │ KMS / Secret │             │
                                  │   │ (gerenciado) │  │ Manager (BR) │             │
                                  │   │ TLS + cripto │  │ chave cripto │             │
                                  │   │ em repouso   │  │ + segredos   │             │
                                  │   └──────┬───────┘  └──────────────┘             │
                                  │          │ backups cifrados (chave SEPARADA)     │
                                  │          ▼                                       │
                                  │   ┌──────────────┐                               │
                                  │   │ Backup store │                               │
                                  └───┴──────────────┴───────────────────────────────┘
                                              │
                  ┌───────────────────────────┴──────────────────────────┐
                  ▼ (transferência internacional — art. 33 LGPD, via DPA) ▼
        ┌────────────────────┐                        ┌────────────────────┐
        │ Anthropic (LLM)    │   minimização:         │ Deepgram (STT)     │
        │ contribuições board│   só o trecho clínico  │ áudio→texto        │
        │ ADR-002 trocável   │   necessário, SEM      │ ADR-002 trocável   │
        └────────────────────┘   rótulo do paciente   └────────────────────┘
```

**Notas de topologia:**
- **Afinidade sticky por `consultationId`** é requisito do runtime (ADR-010 Decisão 2) — o WAF/LB e o proxy WSS devem preservá-la.
- **O áudio nunca persiste em fornecedor**; só o trecho mínimo trafega, sob DPA (ADR-009 Decisão 2, CJ-3). O rótulo do paciente nunca sai para fornecedores. **[REC]** verificar no código que nenhum identificador acompanha o trecho enviado.
- **Subprocessadores externos = transferência internacional** (art. 33) enquanto não houver endpoint BR (ADR-009).

---

## 2. Gestão de segredos

- **Cofre gerenciado obrigatório** (Secret Manager / KMS na região BR — ADR-009 Decisão 4). **Nunca `.env` em servidor de produção.** O `.env` permanece artefato de dev local apenas (CLAUDE.md já alerta que Next lê `apps/web/.env.local`, gitignored). **[REC]**
- 🔐 **BLOQUEANTE — rotação de chaves vazadas:** as keys Anthropic/Deepgram/Gemini **passaram pelo chat** (CLAUDE.md, pendência #7) e **DEVEM ser rotacionadas antes de qualquer ambiente compartilhado**. Tratar como credenciais comprometidas. **[REC, bloqueante de Fase 0]**
- **Rotação periódica** de todos os segredos (keys de fornecedores, chave de sessão, credenciais de DB) com calendário e procedimento documentado. **[REC]**
- **Separação de planos:** a **chave de criptografia (NFR9) não co-reside com os backups** dos dados cifrados (ADR-009 Decisão 4) — comprometer o backup não deve comprometer a chave.
- **Princípio de menor privilégio:** o processo Node recebe só os segredos que usa; sem credenciais de admin de DB no runtime. **[REC]**

---

## 3. Dados

- **Postgres gerenciado em região BR** (ADR-009 Decisão 1; `packages/db` já suporta pg+TLS em prod). **TLS obrigatório** na conexão (NFR9 — trânsito).
- **Criptografia em repouso na aplicação:** AES-256-GCM já implementada (`packages/crypto`, NFR9) para áudio/transcrição/PII sensível.
- **Backups com retenção definida e cifrados** — a **chave de backup é separada da chave de cripto da aplicação** (ADR-009 Decisão 4). **[REC]** o *prazo* de retenção é decisão jurídica: **CJ-2** (retenção mínima prontuário/CFM × máxima minimização LGPD) — bloqueante de piloto.
- **Sem replicação cross-border por default** (ADR-009 Decisão 1) — réplicas/backups também no BR.
- **Minimização do que é persistido:** reter só o necessário; política de descarte/anonimização atrelada a **CJ-2/CJ-7**. **[GAP/jurídico]**

---

## 4. AuthN / AuthZ de produção

- **Base existente:** scrypt + sessões DB-backed (`packages/auth`) — mantida.
- **[REC] Rate-limit de login** (proteção contra brute-force/credential stuffing) — hoje inexistente.
- **[REC] Política de sessão de produção:** expiração/idle-timeout, invalidação no logout, rotação de token de sessão, limite de sessões concorrentes.
- **[REC] MFA para médicos:** dado o acesso a dados sensíveis de saúde, segundo fator para a conta do nutrólogo. Liga-se a **CJ-1/CJ-5/CJ-6** (titularidade do consentimento e responsabilidade médica).
- **[REC] Autorização por escopo:** garantir que um médico só acesse suas próprias consultas (controle de acesso a `consultationId`) — validar no gateway WS e nas rotas.

---

## 5. Trilha de auditoria append-only

- **Base existente:** trilha append-only com proveniência (`packages/audit`, NFR10) — registra contribuições da IA com origem, sustentando "IA assiste, médico decide" (CJ-4).
- **[REC] Imutabilidade reforçada em produção:** permissões de DB que vedem UPDATE/DELETE na tabela de auditoria; idealmente encadeamento/hash sequencial para detectar adulteração.
- **[REC] Cobertura 100% de ações sensíveis:** login/logout, concessão/negação de consentimento (FR20), início/fim de consulta, cada contribuição da IA (NFR10), geração/edição de nota clínica (E9), acesso a dados de paciente, exportações.
- **Tensão a resolver (jurídica):** **CJ-7** — direito de eliminação (art. 18) × imutabilidade da trilha × dever de guarda do prontuário. Evolutivo, mas o processo deve existir antes da 1ª solicitação. **[GAP/jurídico]**

---

## 6. CI/CD com security gates

Pipeline bloqueando merge (princípio Quality First; hoje **[GAP]** — não há CI):
- **Gates funcionais (já existem como comandos):** `lint` + `typecheck` + **187 testes** + `build` (19 pacotes) — promover a gate de PR obrigatório. **[REC]**
- **SAST — CodeQL** sobre TypeScript, bloqueando findings críticos. **[REC]**
- **Scan de dependências — Dependabot/Snyk** (vulnerabilidades + atualização), bloqueando severidade alta. **[REC]**
- **Scan de segredos** no diff (impedir reintrodução de keys no repo — dada a fuga já ocorrida). **[REC]**
- **CodeRabbit pre-PR** já previsto (CLAUDE.md pendência #5).
- **Fronteira de push preservada:** push/PR continuam exclusivos de @devops (regras de fronteira do projeto).

---

## 7. Observabilidade

- **[REC] Logs estruturados SEM conteúdo clínico** — restrição forte de NFR9: nunca logar áudio, transcrição, contribuições ou PII de paciente. Logar IDs/eventos/latências, não conteúdo. Redaction obrigatória.
- **Reaproveitar a telemetria E10** (`packages/telemetry`: custo/gate/latência/ruído) como base de métricas de produto/operação. Lembrar (ADR-010): telemetria é **por-instância** — ao escalar, **agregar cross-instância** num coletor central. **[REC]**
- **[REC] Error tracking (Sentry)** com **scrubbing** de PII/conteúdo clínico configurado (sem payloads de transcrição em stack traces/breadcrumbs).
- **[REC] Alertas:** erros de fornecedor (STT/LLM), falha de gateway WS, custo anômalo (E10), latência fora do orçamento, falhas de auth.

---

## 8. Compliance LGPD / CFM

- **Âncoras existentes:** ADR-009 (residência BR + transferência internacional amparada), ADR-006 (compliance-by-design), NFR9/NFR10, FR20, FR19 (disclaimers).
- **Gate jurídico do piloto:** o piloto com pacientes reais (E10) **não inicia** sem parecer documentado de **CJ-1..CJ-6** (base legal, retenção, residência/transferência, papel assistivo da IA, responsabilidade médica, consentimento paciente×médico). Evolutivos CJ-7..CJ-10 com dono/prazo.
- **Minimização para fornecedores:** enviar a STT/LLM só o trecho necessário, sem identificadores do paciente (ADR-009 Decisão 2, CJ-3). **[REC]** auditar o caminho de envio.
- **[REC] RIPD/DPIA (CJ-8)** e **plano de incidentes ANPD (CJ-10)** — iniciar rascunho antes do piloto.

---

## 9. Roadmap em fases (gates de segurança por fase)

| Fase | Objetivo | Itens-chave | Gate de saída (bloqueante) |
|---|---|---|---|
| **Fase 0 — Perímetro** | Estancar exposição imediata | 🔐 **Rotacionar todas as keys vazadas** (#7); mover segredos do `.env` para cofre; scan de segredos no repo | Nenhuma credencial viva fora do cofre; rotação confirmada |
| **Fase 1 — Fundação de infra** | Tornar deployável em BR | Containerizar o Node server (Dockerfile); IaC mínima; **Postgres gerenciado BR + TLS**; KMS BR (chave cripto separada de backups); instância única sticky (ADR-010) | App roda em região BR; dados duráveis no BR (ADR-009); backups cifrados |
| **Fase 2 — Hardening** | Segurança de runtime e pipeline | CI com gates (lint/typecheck/187 testes/build + CodeQL + Dependabot/Snyk); rate-limit login + política de sessão + **MFA médicos**; auditoria imutável (perm. DB); logs estruturados sem conteúdo clínico + Sentry com scrubbing; graceful drain (ADR-010) | Pipeline bloqueia merge inseguro; auth endurecida; observabilidade sem PII |
| **Fase 3 — Jurídico** | Liberar uso com paciente real | Parecer **CJ-1..CJ-6**; atualizar ADR-009 e stories afetadas; retenção/descarte (CJ-2); DPAs dos fornecedores (CJ-3); RIPD (CJ-8); plano de incidentes (CJ-10) | CJ-1..CJ-6 documentados e incorporados (gate de piloto do checklist) |
| **Fase 4 — Piloto** | Operar com clínicas reais | Monitorar telemetria E10 em produção; revisar teto de carga da instância única; avaliar **Rota B (estado externalizado)** só se métricas exigirem (ADR-010 Decisão 5) | SLA/latência dentro do orçamento; sem incidente de dados; decisão informada sobre escalar |

**Sequência de bloqueio:** Fase 0 antes de qualquer ambiente compartilhado; Fase 3 antes de qualquer paciente real (mesmo que Fases 1-2 estejam prontas tecnicamente).
