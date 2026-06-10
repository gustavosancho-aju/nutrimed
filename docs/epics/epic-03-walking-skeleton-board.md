# E3 — Walking Skeleton do Board

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** M
> **Fonte:** `docs/architecture.md` §13, §4, §7, ADR-003/005 · `docs/prd.md` FR2, FR3, NFR5, NFR12 · `docs/frontend-spec.md` §11.2
> **Depende de:** E2 · **Desbloqueia:** E4, E5, E7 (incremental)
> **🟡 PRÉ-REQUISITO DA POC DE LATÊNCIA/CUSTO (com E2)**

---

## Objetivo / Valor de Negócio

Fechar o **loop fim-a-fim mínimo** que prova a viabilidade do produto: **transcrição → 1 persona → 1 gatilho → 1 contribuição renderizada no feed via WebSocket**. É o entregável que valida o orçamento total de latência (~3–4s, §11), confirma `ADR-005` (orchestrator stateful por sessão) e `ADR-003` (WebSocket como canal de eventos), e dá o primeiro sinal de "uau" demonstrável (NFR12) com risco e custo afundado mínimos.

## Descrição

Implementa o **Board Orchestrator** em sua forma mais simples (1 persona, ex.: Yara com 1 gatilho hardcoded), o **Real-Time Transport** (WebSocket gateway — ADR-003) emitindo eventos de contribuição, e o consumo no cliente (`useBoardStream()` → `useBoardStore`). Inclui ≥ 2 candidatos de LLM medidos no caminho completo. Não tem ainda os guarda-corpos (E4) nem RAG (E5) — usa LLM direto com contexto mínimo para provar o caminho.

## Escopo

### IN
- Board Orchestrator mínimo: 1 persona ativa desde o início da transcrição (FR2 parcial).
- 1 gatilho clínico hardcoded → 1 chamada `ILlmProvider` → 1 contribuição (FR3 parcial).
- WebSocket Gateway: canal de eventos do board (ADR-003), evento de contribuição servidor→cliente.
- Cliente: `useBoardStream()` empurra eventos para `useBoardStore`; render mínimo de 1 card no feed.
- **POC: ≥ 2 candidatos de LLM** medidos no caminho completo fala→render; orçamento de latência §11.
- Validação de `ADR-005` (sessão stateful) sob carga de 1 consulta.

### OUT
- Trigger Detector completo / Scorer / rate-limit / dedup — E4.
- RAG / namespaces por persona — E5.
- 3 personas + síntese — E6.
- UI completa (4 tipos, controles, Modo Foco) — E7.

## Requisitos Rastreados
- **FR:** FR2 (1 das 3 personas ativa), FR3 (contribuição proativa — caminho mínimo)
- **NFR:** NFR5 (latência fim-a-fim medida), NFR12 (confiabilidade de demo — primeiro "uau")
- **ADR:** ADR-003 (WebSocket), ADR-005 (orchestrator stateful — validação)
- **Riscos cobertos:** T1 (latência fim-a-fim), T8 (estado de sessão)

## Dependências
- **Predecessores:** E2 (transcrição como input).
- **Sucessores diretos:** E4 (motores), E5 (RAG), E7 (UI — começa incremental aqui).

## Critérios de Aceitação (alto nível)
1. Com a transcrição rodando, 1 persona ativa detecta 1 gatilho e publica 1 contribuição no feed (FR2/FR3 mínimos).
2. A contribuição trafega por WebSocket (ADR-003) e é renderizada no cliente.
3. Latência total fala→render medida para ≥ 2 candidatos de LLM e documentada (NFR5; alvo ~3–4s §11).
4. O orchestrator mantém estado de sessão corretamente (ADR-005); decisão de runtime registrada em ADR de follow-up.
5. O loop sustenta uma demo ao vivo mínima sem quebrar (NFR12).

## Riscos Relevantes
- **T1 (latência) — Alta:** este é o teste decisivo do orçamento §11. Se o LLM domina, decidir modelo rápido p/ classificação e modelo forte só p/ contribuição.
- **T8 (estado de sessão) — Média:** define se runtime é serverless puro (improvável) vs. serviço long-lived; afeta E4/E6.
- **Escopo creep:** manter walking skeleton **fino**; não antecipar guarda-corpos nem RAG (isso é E4/E5).

## Stories Candidatas (esboço — detalhamento por @sm)
1. Board Orchestrator mínimo (1 persona, 1 gatilho hardcoded) — *@architect · @pm*
2. WebSocket Gateway: canal de eventos do board (ADR-003) — *@dev · @architect*
3. `useBoardStream()` + `useBoardStore` + render de 1 card — *@dev · @architect*
4. POC: ≥ 2 candidatos de LLM no caminho completo (latência NFR5) — *@analyst · @pm*
5. Validar ADR-005 (sessão stateful) + ADR de decisão de runtime — *@architect · @pm*
