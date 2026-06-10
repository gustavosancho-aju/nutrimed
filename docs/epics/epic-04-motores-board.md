# E4 — Motores do Board

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** L
> **Fonte:** `docs/architecture.md` §13, §3, §4, ADR-008 · `docs/prd.md` FR3, FR4, FR5, FR11, FR12, NFR1, NFR2 · `docs/personas-knowledge-base-seed.md` (gatilhos)
> **Depende de:** E3 · **Desbloqueia:** E6

---

## Objetivo / Valor de Negócio

Construir os **guarda-corpos lógicos no servidor** que tornam o board útil em vez de ruidoso e barato em vez de caro: **Trigger Detector** (gatilhos clínicos por persona), **Relevance Scorer + Gate** (limiar de relevância, rate-limit, deduplicação) e o **gating de pausa natural**. Sem isto, o board ou cala demais (perde valor) ou fala demais (distrai o médico — risco R3) e estoura o custo de LLM (risco T2). É o controle direto sobre os dois maiores riscos operacionais do produto.

## Descrição

Implementa, no servidor (fonte de verdade — ADR-008): (a) **Trigger Detector** por persona casando gatilhos clínicos da transcrição (`[KB]`); (b) **Scorer + Gate** com score de confiança/relevância ≥ limiar configurável (NFR1), teto de contribuições por minuto por doutor com fila de prioridade (NFR2), deduplicação/consolidação (FR11), e gating por pausa natural para 💡/🔍 com ⚠️ críticos furando a fila (FR12). **Trigger barato (regra/embedding) ANTES do LLM** para conter custo (T2). Inclui os gatilhos específicos de Paulo (FR4) e Yara (FR5).

## Escopo

### IN
- **Trigger Detector** por persona (gatilhos de `[KB]`), incluindo FR4 (alerta CV: GLP-1, anfepramona, sibutramina, termogênicos, PA/palpitação/dor torácica/dispneia) e FR5 (hipótese hormonal: cansaço, ganho de peso, frio, queda de cabelo, platô).
- **Relevance Scorer + Gate:** score ≥ limiar configurável (NFR1).
- **Rate-limit** por doutor com fila de prioridade; ⚠️ críticos furam a fila; redundância descartada (NFR2).
- **Deduplicação/consolidação** server-side (FR11) — base para o card "consolidado".
- **Gating de pausa natural** (≥ 2,5s ou fim de turno `[A4]`) para não-críticos; ⚠️ entrega imediata com `severity=critical` (FR12).
- Classificação do tipo de contribuição no servidor (⚠️/💡/🔍).
- Defaults configuráveis (limiar, rate-limit, pausa) — calibração fina fica para E10/piloto.

### OUT
- Geração textual da contribuição via RAG — E5 (este épico decide *se* e *quando*, não *o conteúdo*).
- Synthesizer / divergência / 3 personas integradas — E6.
- Decaimento/fila visual no cliente — E7 (apresentação, ADR-008).

## Requisitos Rastreados
- **FR:** FR3 (proatividade gated), FR4 (gatilhos Paulo), FR5 (gatilhos Yara), FR11 (dedup), FR12 (pausas)
- **NFR:** NFR1 (score relevância), NFR2 (rate-limit)
- **ADR:** ADR-008 (lógica no servidor)
- **Riscos cobertos:** T2 (custo LLM — gating antes do LLM), R3 (distração — controle de ruído lógico)
- **Open items endereçados:** O2 (defaults de limiar/rate-limit), O3 (definição de pausa natural)

## Dependências
- **Predecessores:** E3 (loop fim-a-fim + orchestrator).
- **Sucessores diretos:** E6 (board completo consome os motores para as 3 personas).
- **Acopla com:** E5 (Reasoner é chamado só após o Gate aprovar) e E7 (apresentação dos guarda-corpos).

## Critérios de Aceitação (alto nível)
1. Gatilhos por persona disparam candidatos a partir da transcrição (FR3); FR4 e FR5 detectados sobre os termos de `[KB]`.
2. Uma contribuição só é liberada se o score ≥ limiar configurável (NFR1).
3. Rate-limit por doutor respeitado; ⚠️ críticos furam a fila e não contam no teto (NFR2).
4. Contribuições redundantes de 2 personas são consolidadas em 1 (FR11).
5. 💡/🔍 aguardam pausa natural; ⚠️ entregam imediatamente com `severity=critical` (FR12).
6. **Trigger barato roda antes do LLM** — não há chamada de LLM em todo segmento de transcrição (T2).

## Riscos Relevantes
- **T2 (custo de LLM) — Média:** o gate é o principal controle de custo; verificar por métrica que LLM só é chamado após aprovação (instrumentação completa em E10).
- **R3 (distração) — Alta:** calibração de limiar/rate-limit é provisória (defaults); a calibração real depende de piloto (E10). `[O2][O3]`
- **Falsos negativos em ⚠️:** um gatilho crítico perdido tem custo assimétrico — priorizar recall em FR4 sobre precisão.

## Stories Candidatas (esboço — detalhamento por @sm)
1. Trigger Detector por persona (framework de gatilhos de `[KB]`) — *@dev · @architect*
2. Gatilhos de segurança CV do Paulo (FR4) — *@dev · @architect*
3. Gatilhos hormonais/metabólicos da Yara (FR5) — *@dev · @architect*
4. Relevance Scorer + limiar configurável (NFR1) — *@dev · @architect*
5. Rate-limit por doutor + fila de prioridade + ⚠️ fura-fila (NFR2) — *@dev · @architect*
6. Deduplicação/consolidação server-side (FR11) — *@dev · @architect*
7. Gating de pausa natural + entrega imediata de críticos (FR12, A4) — *@dev · @architect*
