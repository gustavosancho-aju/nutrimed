# ADR-015 — Estimativa Nutricional por Foto é Aproximada, Não Prescrição

| Campo | Valor |
|---|---|
| **Status** | **Aceito (direção)** — implementação nas Fases 3–5 do E12 |
| **Data** | 2026-07-01 |
| **Autor** | Aria (@architect) — E12 (Bot de Telegram) · orquestração @aios-master |
| **Fontes** | `docs/epics/epic-12-telegram-nutricao.md` (FR29, FR33); ADR-006/NFR10 ("IA assiste, médico decide"), ADR-012 (extração por IA + validação humana), ADR-002/NFR8 (fornecedor plugável); FR19 (disclaimers persistentes) |

## Contexto

O bot estima nutrientes (kcal, proteína, carbo, gordura) a partir de uma **foto de prato** e dá uma **orientação curta** ao paciente sobre o consumo do dia frente às metas. Duas armadilhas regulatórias:

1. **Confiar cego na estimativa**: fotos são ambíguas (porção, ângulo, itens ocultos). Tratar o número como dado clínico definitivo violaria a postura NFR10.
2. **A orientação soar como prescrição**: um bot que "recomenda" ao paciente diretamente pode ser lido como ato médico autônomo (tensão com CFM — ver CJ-4).

Este ADR é o irmão do **ADR-012** aplicado à **visão de fotos de refeição**: mesma postura, novo domínio.

## Decisão

1. **A estimativa é explicitamente aproximada, com incerteza declarada.** A saída (`FoodEstimate`) carrega `confidence: 'low' | 'medium' | 'high'`; a mensagem ao paciente **sempre** marca "estimativa automática aproximada".

2. **As metas são exclusivamente humanas.** kcal/macros-alvo são definidos **apenas pelo nutricionista** (Story 12.4). O bot **nunca inventa metas**: sem meta definida, ele registra o consumo e informa que o nutricionista ainda não definiu as metas.

3. **A orientação é de apoio, não prescrição.** O feedback textual (gerado via `ILlmProvider`) é curto, factual (consumo vs. meta) e acompanha **disclaimer obrigatório**: *"Estimativa automática, não substitui a orientação do seu nutricionista."* (materializa FR19 no canal do paciente). **Sem chat aberto** de dúvidas nutricionais no MVP (contém o risco de parecer aconselhamento clínico autônomo).

4. **Fronteira de confiança na sanitização.** `sanitizeFoodEstimate` aceita só nutrientes conhecidos (`KNOWN_NUTRIENTS`), numéricos finitos, `confidence` válido — e **nunca lança** (entrada inválida ⇒ estimativa vazia/degradada). Mesmo padrão de `sanitizeExtraction` (ADR-012).

5. **Estimador plugável** (`IFoodEstimator`, NFR8/ADR-002): Claude com content block de **imagem** como 1ª implementação; **fake determinístico** para dev/testes; `modelVersion` registrado na auditoria do `food_log_entry` (NFR10).

## Consequências

**Positivas:** postura CFM/LGPD defensável (estimativa ≠ diagnóstico; meta humana; disclaimer sempre); robustez a fotos ruins (confidence + degradação); troca de modelo/canal sem reescrita; risco de aconselhamento autônomo contido (sem chat aberto no MVP).

**Negativas/custos:** a estimativa por foto tem erro inerente (comunicado como incerteza, não escondido); custo de tokens de visão por foto a monitorar (NFR7); a ausência de chat aberto limita a "conversa" no MVP (decisão de produto consciente).

**Follow-ups:** medir precisão/custo no piloto; futura **correção da estimativa pelo nutricionista** na UI (fecha o loop "IA assiste, humano decide"); reavaliar chat conversacional só com salvaguardas jurídicas.

## Relação com outros ADRs

- **ADR-006 / NFR10** (IA assiste, médico decide): este ADR é a aplicação direta à estimativa por foto.
- **ADR-012** (laudo por IA): mesma postura (rascunho aproximado + humano decide) em outro domínio; padrão de sanitização compartilhado.
- **ADR-002 / NFR8** (fornecedor plugável): `IFoodEstimator` é a aplicação à visão.
- **ADR-013** (canal Telegram): a foto trafega pelo canal externo sob as salvaguardas de lá.
- **Checklist jurídico:** liga a **CJ-4** (IA como apoio à decisão) e **CJ-12** (canal do paciente).
