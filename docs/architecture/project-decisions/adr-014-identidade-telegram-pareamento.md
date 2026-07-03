# ADR-014 — Identidade Telegram → Paciente por Código de Pareamento

| Campo | Valor |
|---|---|
| **Status** | **Aceito** — implementação na Fase 2 do E12 |
| **Data** | 2026-07-01 |
| **Autor** | Aria (@architect) — E12 (Bot de Telegram) · orquestração @aios-master |
| **Fontes** | `docs/epics/epic-12-telegram-nutricao.md` (FR28, FR32); `packages/crypto/src/aes-gcm.ts` (IV aleatório); ADR-013 (canal Telegram/LGPD), ADR-009 (residência), `@nutrimed/consent` (padrão de gate) |

## Contexto

O bot é **único para todos os pacientes**; cada mensagem chega com um `chat_id` do Telegram. É preciso resolver **`chat_id` → `patient_id`** de forma segura e inequívoca, para registrar o consumo no paciente certo. A intuição inicial ("vincular pelo número de telefone do paciente") esbarra em duas barreiras:

1. **Técnica:** o telefone é cifrado em `patient.phone_enc` com **AES-256-GCM de IV aleatório** (`packages/crypto/src/aes-gcm.ts:24`). Cifrar o mesmo telefone duas vezes produz payloads diferentes ⇒ **não é possível buscar paciente por igualdade de telefone cifrado**. Habilitar busca exigiria uma **coluna determinística** (ex.: HMAC-SHA256 do E.164), o que adiciona: um **novo segredo** (`PHONE_HMAC_KEY`), normalização de telefone e uma **superfície de PII pesquisável/enumerável**.
2. **De privacidade:** um bot público que aceita telefone abre **vetor de enumeração** (tentar números para descobrir quem é paciente) e permite auto-vínculo sem passar pelo médico.

## Decisão

1. **O vínculo é feito por um código de pareamento de uso único**, gerado pelo **nutricionista** na ficha do paciente. Fluxo: médico clica "Vincular Telegram" → sistema gera um **código curto**, exibido **uma vez**, com **TTL curto** (default 15 min) → paciente envia `/start CÓDIGO` ao bot → o bot resolve `código → patient_id`, cria o vínculo em `telegram_link` e **invalida o código**.

2. **O ato de parear é o registro de consentimento do canal** (ADR-013): o vínculo nasce com autoria (`linked_by_user_id`), data (`linked_at`) e é **revogável** (`revoked_at`).

3. **Só se guarda o hash do código** (`telegram_pairing_code.code_hash`, SHA-256) — nunca o código em claro. Busca por hash é determinística e aceitável: é um **token efêmero de pareamento, não PII médica**.

4. **Um canal ativo por paciente** (índice único parcial `telegram_link(patient_id) WHERE revoked_at IS NULL`), preservando histórico de vínculos revogados.

5. **Rejeitada a coluna determinística de telefone (HMAC).** O único ganho seria "não digitar um código"; o custo (novo segredo, PII pesquisável, enumeração) é desproporcional. O compartilhamento de contato do Telegram fica como **possível pré-preenchimento de UX futuro**, mas **não** como mecanismo de resolução de identidade.

## Consequências

**Positivas:** vínculo inequívoco e sob controle do médico; consentimento rastreável embutido no fluxo (ADR-013); **zero PII pesquisável** e sem vetor de enumeração; sem novo segredo criptográfico; código descartável e expirável.

**Negativas/custos:** exige um passo manual do médico (gerar código) e do paciente (enviar o código) — aceitável e alinhado à postura "médico no controle"; código pode expirar antes do uso (mitigado por regenerar).

**Follow-ups:** definir TTL e formato do código na Story 12.3; UI de "Vincular / status / revogar" na Story 12.4.

## Relação com outros ADRs

- **ADR-013** (canal Telegram/LGPD): o pareamento é o **registro de consentimento** ali exigido.
- **ADR-009** (residência): o mapeamento `chat_id → patient_id` reside no BR; ao Telegram só vai o `chat_id`.
- **Padrão `@nutrimed/consent`**: o gate `isChannelAuthorized` (default NEGA) espelha `isCaptureAuthorized`.
