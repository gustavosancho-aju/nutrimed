# ADR-012 — Importação de Laudos: Extração por IA com Validação Médica Obrigatória

| Campo | Valor |
|---|---|
| **Status** | **Aceito (direção)** — implementação na Fase 4 do E11; canal/fornecedor confirmados na comercialização e pela consultoria jurídica (CJ-3, CJ-11) |
| **Data** | 2026-06-23 |
| **Autor** | Aria (@architect) — E11 (Pacientes & Dashboard) |
| **Fontes** | `docs/epics/epic-11-pacientes-dashboard.md` (FR27, NFR13); `docs/prd.md` NFR8, NFR9, NFR10; ADR-002 (abstração de fornecedores), ADR-006 (compliance-by-design), ADR-009 (residência BR); `checklist-consultoria-juridica.md` (CJ-3/CJ-4) |

## Contexto

A Fase 4 do E11 importa laudos (bioimpedância — InBody etc. — e exames laboratoriais) em **PDF**, cujos formatos são altamente variados. O objetivo é pré-preencher as medições de evolução (composição corporal / exames) sem digitação manual, **sem nunca confiar cego em extração automática de dado clínico**. O produto é comercial (vendido a nutrólogos) e trata dado sensível de saúde sob LGPD/CFM.

Restrições e princípios vigentes:
- **NFR10 / ADR-006:** "a IA assiste, o médico decide" — postura regulatória inegociável.
- **NFR8 / ADR-002:** a camada de fornecedores (STT/LLM) é abstraída e trocável.
- **NFR9 / ADR-009:** dado de saúde em repouso reside no BR; processamento externo é transferência internacional, minimizada e amparada por DPA (art. 33 LGPD).
- **NFR13 (E11):** a importação é **aditiva**; a dashboard opera 100% por entrada manual mesmo sem extração.

## Decisão

1. **Validação médica é OBRIGATÓRIA e inegociável.** Nenhum valor extraído de um laudo é persistido sem **confirmação/correção explícita do médico** numa tela de revisão. A IA produz apenas um **rascunho estruturado**; o gate de persistência exige a ação humana. Não há caminho de importação que grave automaticamente — nem "modo confiança", nem auto-save, nem importação em lote sem revisão item a item. Isso vale para qualquer fornecedor de extração, presente ou futuro.

2. **A extração é um fornecedor PLUGÁVEL** atrás de uma interface (`ILabExtractor`), no mesmo padrão de STT/LLM (NFR8/ADR-002). Trocar a fonte de extração não pode exigir reescrita da tela de confirmação nem dos serviços de medição (`@nutrimed/patients`).

3. **Primeira implementação: Claude lendo o PDF nativamente** (entrada de documento/visão). Razões: entende tabela + layout + semântica clínica num passo, robusto à variedade de laudos, já no stack. O modelo registra `modelVersion` na trilha de auditoria (NFR10) da medição resultante.

4. **O CANAL de acesso ao modelo é reavaliável sem mudar o produto.** Para o piloto, API direta da Anthropic é aceitável (escopo mínimo, sem identificadores do paciente no envio). Para a **comercialização**, o canal pode migrar para **AWS Bedrock / Google Vertex AI** (governança empresarial, DPA, regiões) ou um **Document AI regional** (OCR com região BR) + LLM para estruturação — conforme exigências de custo (NFR7), residência (ADR-009) e o parecer jurídico. Como tudo está atrás do `ILabExtractor`, a troca de canal é configuração, não refatoração.

5. **Minimização (ADR-009/CJ-3):** envia-se ao extrator apenas o laudo necessário; identificadores diretos do paciente não são incluídos no payload de extração quando evitável. O resultado é cifrado em repouso (NFR9) e auditado (NFR10) ao ser confirmado.

6. **Degradação graciosa (NFR13):** falha de extração (ex.: PDF escaneado sem camada de texto, fornecedor indisponível) **nunca bloqueia** — a tela cai para entrada manual, que é sempre o caminho garantido.

## Consequências

**Positivas:** postura CFM/LGPD defensável (o humano é sempre o gate — reforça NFR10/CJ-4); robustez de extração sem acoplar a um fornecedor; caminho comercial (Bedrock/Vertex/Document AI regional) aberto sem retrabalho; risco de erro de extração contido pela confirmação obrigatória.

**Negativas/custos:** a confirmação obrigatória adiciona um passo de UX (intencional — é a salvaguarda); custo de tokens de visão por página a monitorar (NFR7) na escala; transferência internacional a amparar por DPA enquanto o canal não for regional (CJ-3).

**Follow-ups:** stories 11.9 (extração → rascunho estruturado) e 11.10 (tela de confirmação → grava medição); na comercialização, decidir canal definitivo (API vs Bedrock/Vertex vs Document AI) com o jurídico; medir custo/página no piloto.

## Relação com outros ADRs / itens

- **ADR-002** (abstração de fornecedores): `ILabExtractor` é a aplicação do mesmo princípio à extração de laudos.
- **ADR-006 / NFR10** (compliance-by-design / "IA assiste, médico decide"): a Decisão 1 é a materialização direta na importação de dados.
- **ADR-009** (residência BR): governa o canal/fornecedor da Decisão 4; a escolha definitiva herda o critério eliminatório de região BR.
- **ADR-011** (modelo de medições): o resultado confirmado é gravado como medição (blob cifrado) por `@nutrimed/patients`.
- **Checklist jurídico:** ver **CJ-3** (transferência internacional) e o novo **CJ-11** (importação de laudo externo + validação médica).
