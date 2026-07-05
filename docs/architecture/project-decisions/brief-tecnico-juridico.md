# Brief Técnico para Consultoria Jurídica — NutriMed

> **Propósito:** fornecer ao advogado de proteção de dados / direito médico os **fatos
> técnicos** necessários para responder o [Checklist de Consultoria Jurídica](checklist-consultoria-juridica.md)
> (CJ-1..CJ-13) sem precisar ler o código. **Isto NÃO é parecer jurídico** — são insumos
> factuais. Data-base: 2026-07-04. Estado: produção em `nutrimed.fly.dev`.

## 1. O que o sistema faz (1 parágrafo)

Ferramenta de apoio a **nutrólogos** durante a consulta: transcreve a fala em tempo real,
um "board" de 3 personas de IA levanta pontos clínicos (sempre como sugestão), e ao fim
gera documentos **rascunho** (nota clínica, relatório nutricional) que o médico revisa,
edita e assume. Há um canal opcional de acompanhamento por Telegram (foto de refeição →
estimativa nutricional). Postura central: **"IA assiste, o médico decide"**.

## 2. Inventário de dados (o que é coletado e onde fica)

Tudo em repouso é cifrado com **AES-256-GCM** (coluna sufixo `_enc`), no Postgres gerenciado
**Neon, região sa-east-1 (São Paulo/BR)**; compute no **Fly.io GRU (São Paulo/BR)**.

| Dado | Natureza | Onde (tabela) | Cifrado |
|---|---|---|---|
| Nome, telefone, nascimento, objetivo do paciente | Pessoal + sensível | `patient` | ✅ |
| Rótulo da consulta | Pessoal | `consultation` | ✅ |
| Transcrição crua do STT | **Sensível (saúde)** | `transcript_segment` | ✅ |
| Transcrição corrigida pelo médico | **Sensível (saúde)** | `transcript_review` | ✅ |
| Nota clínica | **Sensível (saúde)** | `clinical_note` | ✅ |
| Relatório nutricional + cálculo | **Sensível (saúde)** | `nutrition_report` | ✅ |
| Sínteses do board | **Sensível (saúde)** | `board_synthesis` | ✅ |
| Bioimpedância, exames laboratoriais | **Sensível (saúde)** | `body_composition`, `lab_exam` | ✅ |
| Metas e registro alimentar | **Sensível (saúde)** | `nutrition_goal`, `food_log_entry` | ✅ |
| Vínculo do canal Telegram | Pessoal (chat_id) | `telegram_link` | parcial |
| Trilha de auditoria | Metadados (proveniência) | `audit_log` (append-only) | não contém conteúdo clínico |

**Não é persistido:** o **áudio bruto** da consulta (só a transcrição) e a **foto do prato**
do Telegram (só o `file_id` de referência — ADR-013).

## 3. Transferência internacional (o que sai do BR e para quem) — insumo de CJ-3

O dado **em repouso fica no BR** (Neon SP). O **processamento** usa fornecedores fora do BR,
de forma **efêmera** (não persistimos no destino; a retenção deles é regida pelo DPA de cada um):

| Destino | O que recebe | País | Finalidade | Persistência nossa |
|---|---|---|---|---|
| **Deepgram** | stream de áudio + transcrição | EUA | Speech-to-text | efêmero |
| **Anthropic (Claude)** | trechos da transcrição, contexto do board, recordatório, foto do prato (Telegram) | EUA | Contribuições do board, documentos, visão do prato | efêmero |
| **Telegram** | `chat_id`, mensagens do bot, foto do prato do paciente | int'l | Canal de acompanhamento (opt-in, default NEGA) | só `photoRef` |
| **Google Gemini** | — (apenas geração de retratos das personas; **não** recebe dado de paciente) | EUA | Avatares | n/a |

Referência de arquitetura: **ADR-009** (repouso no BR; processamento externo efêmero via
art. 33 LGPD com minimização) e **ADR-002** (fornecedores atrás de interface plugável —
trocar por região BR/on-prem = nova classe, sem mudar o domínio).

## 4. Segurança e governança (insumo de CJ-1, CJ-4, CJ-7)

- **Cifra em repouso:** AES-256-GCM, chave via secret manager (não versionada).
- **Trilha de auditoria:** `audit_log` **append-only** com trigger de imutabilidade no banco
  (rejeita UPDATE/DELETE) — cada escrita registra origem, fontes e versão do modelo (NFR10).
- **Gate de consentimento:** tabela `consent`, 1:1 com a consulta, **default `granted=false`
  (nega por omissão)**; o servidor é a fonte de verdade — sem `granted=true`, nenhum áudio é
  capturado/transmitido (FR20).
- **Disclaimers persistentes:** "Sugestão de apoio. A conduta é sua." em toda tela (FR19).

## 5. Fluxo de consentimento HOJE (insumo de CJ-1, CJ-6)

O consentimento de gravação é registrado por **ação do médico autenticado** (`consent.granted_by`
= id do usuário médico, `granted_at`). **Não há** captura direta do aceite do **paciente**
(assinatura, áudio do aceite ou documento apartado). O canal Telegram tem consentimento
**por canal**, também default NEGA, revogável (ADR-013). → **Lacuna a decidir:** se o registro
via médico basta como base legal, ou se o titular-paciente precisa aceitar diretamente.

## 6. Retenção HOJE (insumo de CJ-2) — **lacuna a definir**

**Não há política de descarte automático.** Todos os artefatos da §2 são retidos
**indefinidamente**. Há a tensão a resolver: prazo **mínimo** (guarda de prontuário/CFM) vs.
**máximo** (minimização LGPD), e como conciliar pedido de eliminação do titular (art. 18) com
a **imutabilidade** da trilha de auditoria (CJ-7). O sistema já suporta cifra + escopo mínimo;
falta a **regra de negócio** (prazos + job de descarte/anonimização) que a consultoria definir.

## 7. Papel da IA (insumo de CJ-4, CJ-5)

- Todo output de IA é **rascunho**; o médico revisa, edita e assume (nota, relatório,
  transcrição corrigida). Nada vira registro sem passar pelo médico.
- No relatório nutricional, os **números não são inventados pela IA** — são calculados
  deterministicamente pela tabela TACO (dado público); a IA só redige.
- Proveniência auditável (modelo, versão, fontes) em cada geração.
→ Insumo para avaliar se afasta caracterização de **ato médico autônomo** (CFM Res. 2.314/2022).

## 8. Mapa CJ → fatos deste brief

| CJ | Onde olhar | Lacuna que depende da consultoria |
|---|---|---|
| CJ-1 base legal | §4, §5 | consentimento (art. 11 I) vs. tutela da saúde (II, f) |
| CJ-2 retenção | §2, §6 | prazos mín/máx + política de descarte |
| CJ-3 transferência int'l | §3 | cláusulas de DPA; exigir região BR? |
| CJ-4 IA como apoio | §4, §7 | suficiência do enquadramento p/ CFM |
| CJ-5 responsabilidade | §7 | alocação nos termos de uso |
| CJ-6 consentimento paciente | §5 | registro direto do paciente? |
| CJ-7 direitos do titular | §4, §6 | eliminação vs. trilha imutável |
| CJ-11/12/13 | §2, §3 | laudos por IA / canal Telegram / relatório nutricional |

## 9. O que o dev já entregou (não bloqueia a consultoria)

Cifra em repouso, trilha imutável, consentimento default-NEGA, disclaimers, residência no BR
(Neon SP), fornecedores plugáveis, IA como rascunho revisável. **O que falta é decisão jurídica
+ regras de negócio (retenção/consentimento do paciente)** — não é limitação técnica.
