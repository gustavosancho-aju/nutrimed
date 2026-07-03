# ADR-013 — Canal Telegram para Acompanhamento do Paciente: Residência de Dados e LGPD

| Campo | Valor |
|---|---|
| **Status** | **Aceito (direção)** — vale para o **piloto**; confirmação final e canal definitivo condicionados à consultoria jurídica (**CJ-12**, liga a CJ-3) e à comercialização |
| **Data** | 2026-07-01 |
| **Autor** | Aria (@architect) — E12 (Bot de Telegram) · orquestração @aios-master |
| **Fontes** | `docs/epics/epic-12-telegram-nutricao.md` (FR28–FR33, NFR14); ADR-006 (compliance-by-design), ADR-009 (residência BR), ADR-012 (extração por IA + validação humana), ADR-002 (abstração de fornecedores); `checklist-consultoria-juridica.md` (CJ-3, novo CJ-12) |

## Contexto

O E12 introduz um **canal de acompanhamento assíncrono do paciente**: um **bot único de Telegram** (o mesmo para todos os pacientes) em que o paciente envia a **foto do prato** e recebe uma **estimativa nutricional aproximada** e o progresso do dia frente às **metas definidas pelo nutricionista**. É a primeira superfície do produto **voltada ao paciente** (as anteriores eram voltadas ao médico).

O conflito central: **Telegram é um serviço externo, com servidores fora do Brasil.** Enviar a foto do prato e trocar mensagens implica **transferência internacional** e uso de um **sub-processador não-BR** — tensão direta com o ADR-009 (dados de saúde em repouso no BR; processamento externo minimizado e amparado por DPA/art. 33 LGPD). Além disso, o vínculo de uma foto de refeição a metas nutricionais de um paciente identificável é **dado de saúde** (art. 11 LGPD).

Restrições e princípios vigentes:
- **ADR-009 / NFR9:** dado de saúde e PII em repouso residem no BR; processamento externo é transferência internacional, minimizada e amparada por DPA.
- **ADR-006 / NFR10:** "a IA assiste, o médico decide" — a estimativa é aproximada e as metas são humanas (ver ADR-015).
- **ADR-002 / NFR8:** fornecedores e canais são abstraídos e trocáveis (o estimador atrás de `IFoodEstimator`; o transporte do bot isolado da lógica).
- **ADR-012:** precedente direto — enviar um artefato do paciente (laudo) a um modelo externo já foi aceito para o piloto, com minimização e canal reavaliável.

## Decisão

1. **Consentimento explícito do paciente por canal, como gate de servidor (default NEGA).** Nenhuma mensagem/foto é processada para um `chat_id` que não esteja **pareado e consentido**. O **ato de parear** (ver ADR-014) **é o registro de consentimento** — rastreável, com data e autoria, e **revogável** pelo nutricionista a qualquer momento. Espelha o `@nutrimed/consent` (FR20).

2. **Minimização de dados no canal externo.** **Nenhum identificador direto do paciente** (nome, telefone, nascimento) é enviado ao Telegram. O único elo é o `chat_id`; o mapeamento `chat_id → patient_id` vive **cifrado e no BR**. A foto vai ao **estimador** (Claude) no mesmo enquadramento do ADR-012 (escopo mínimo, sem identificadores no payload).

3. **A imagem NÃO é persistida por default.** Guarda-se apenas a **estimativa cifrada** (`food_log_entry.values_enc`) e, opcionalmente, o `photo_ref` (o `file_id` do Telegram — uma referência, não os bytes). Persistir a imagem seria uma decisão nova, sujeita a novo consentimento e política de retenção (liga a CJ-2).

4. **Canal reavaliável sem mudar o produto.** Para o **piloto**, Telegram é aceitável (validação de produto com escopo mínimo). Para a **comercialização**, canais com melhor residência/governança (WhatsApp Business regional, **app próprio**, ou canal com endpoint BR) são reavaliados. Como o **transporte é isolado da lógica** (lógica em `@nutrimed/telegram-bot`; transporte no route handler), a troca de canal é **substituição de camada, não reescrita** — mesmo espírito do ADR-012 Decisão 4.

5. **Termo de uso do paciente exibido no pareamento.** No momento do pareamento, o paciente recebe um aviso claro (link web) de que os dados trafegam por um canal externo (Telegram) e para que servem — condição do consentimento válido. Novo item de checklist jurídico **CJ-12**.

6. **Bloqueante para piloto com pacientes reais.** Como CJ-1…CJ-6, este canal **não vai ao ar com pacientes reais** sem parecer jurídico documentado (CJ-12, ligado a CJ-3). O **desenvolvimento e os testes com dados fictícios/fake não dependem disto** (o estimador tem fake determinístico; a fundação de dados é 100% interna).

## Consequências

**Positivas:** postura LGPD defensável (consentimento por canal + minimização + não-persistência da imagem + revogabilidade); caminho comercial (WhatsApp/app próprio) aberto sem retrabalho; coerente com ADR-006/009/012; risco de vínculo errado contido pelo pareamento (ADR-014).

**Negativas/custos:** transferência internacional a amparar por DPA enquanto o canal não for regional (CJ-3/CJ-12); dependência de um sub-processador (Telegram) fora do controle de residência; custo de tokens de visão por foto a monitorar (NFR7); a UX do paciente ganha um passo de consentimento (intencional — é a salvaguarda).

**Follow-ups:** CJ-12 (parecer sobre canal + termo do paciente); na comercialização, decidir canal definitivo com o jurídico; política de retenção do `food_log` e do `photo_ref` (liga a CJ-2); RIPD/DPIA do canal do paciente (liga a CJ-8).

## Relação com outros ADRs / itens

- **ADR-009** (residência BR): governa este canal; a escolha definitiva herda o critério de residência BR.
- **ADR-006 / NFR10** (compliance-by-design): consentimento, auditoria e minimização são a materialização no canal do paciente.
- **ADR-012** (laudo por IA): precedente de envio de artefato do paciente a modelo externo com minimização e canal reavaliável.
- **ADR-014** (identidade por pareamento) e **ADR-015** (estimativa aproximada): decisões irmãs do E12.
- **Checklist jurídico:** **CJ-3** (transferência internacional) e o novo **CJ-12** (canal Telegram do paciente + termo de uso).
