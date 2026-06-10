# E10 — Observabilidade & Piloto

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** M
> **Fonte:** `docs/architecture.md` §13, §11 (custo/latência) · `docs/prd.md` §9 (métricas), NFR7, NFR12, R3, O2, O3 · `docs/frontend-spec.md` §13.7
> **Depende de:** E6, E7 · **Desbloqueia:** — (alimenta a calibração transversal)

---

## Objetivo / Valor de Negócio

Tornar o produto **mensurável e calibrável** — fechar o ciclo de aprendizado que decide o futuro do board. Instrumenta o **custo por consulta** como métrica de primeira classe (NFR7, controla risco T2/R6), as **métricas de ruído** (uso de silenciar / Modo Foco) que validam ou refutam a escolha estratégica "Board Ativo" (risco R3, frontend-spec §13.7), e a **telemetria de calibração** (limiar de relevância, rate-limit, pausa natural) para ajuste com dados reais do piloto. É o que transforma suposições (O2/O3) em decisões baseadas em dados e sustenta uma **demo confiável** (NFR12).

## Descrição

Implementa instrumentação de **custo/consulta** (chamadas de LLM/STT, tokens, vídeo), métricas de produto da PRD §9 (taxa de aceite de sugestões, uso de silenciar/Modo Foco, adoção em consulta), telemetria de latência fim-a-fim (§11), e a infraestrutura de **calibração** (defaults ajustáveis com base em dados). Define o **gatilho de decisão Board Ativo vs. Quiet Board**: se uso de Modo Foco/silenciar > 20% das consultas, o default migra para Quiet Board (frontend-spec §13.7, métrica-chave de R3). Suporta a operação do **piloto** com design partners.

## Escopo

### IN
- **Custo por consulta** instrumentado (LLM/STT/tokens/vídeo) — métrica de primeira classe (NFR7).
- **Métricas de ruído:** taxa de uso de silenciar (FR13) e Modo Foco (FR16) por consulta (R3).
- Métricas de produto da PRD §9: taxa de aceite de sugestões (dispensadas úteis vs. ignoradas), adoção em consulta.
- **Telemetria de latência** fim-a-fim (§11) em produção.
- **Telemetria de calibração:** dados para ajustar limiar de relevância (NFR1), rate-limit (NFR2), pausa natural (`[A4]`) — O2/O3.
- Gatilho de decisão **Board Ativo → Quiet Board** se ruído > 20% (frontend-spec §13.7).
- Suporte operacional ao piloto com design partners.

### OUT
- Calibração *fina* definitiva — é trilha transversal contínua alimentada por estes dados (não um entregável fechado).
- Pesquisa primária de mercado com nutrólogos (O5) — atividade de produto/analyst, não de engenharia (mas E10 fornece os dados de uso).
- Dashboards de negócio/ARR (métricas comerciais da §9) — fora do escopo técnico do MVP `[ASSUMPTION]`.

## Requisitos Rastreados
- **NFR:** NFR7 (custo unitário medido), NFR12 (confiabilidade de demo — telemetria)
- **Métricas (PRD §9):** taxa de aceite, uso de silenciar/Modo Foco, adoção em consulta, profundidade percebida (qualitativa, via piloto)
- **Riscos cobertos:** R3 (distração — métrica de ruído + gatilho Quiet Board), T2/R6 (custo de LLM/unitário)
- **Open items endereçados:** O2 (calibração de limiar/rate-limit), O3 (pausa natural), parte de O5 (dados de uso para validação)

## Dependências
- **Predecessores:** E6 (board completo para medir) **e** E7 (UI com controles para medir uso de silenciar/Modo Foco).
- **Sucessores diretos:** nenhum direto; **alimenta a trilha transversal de calibração de ruído**.

## Critérios de Aceitação (alto nível)
1. Custo por consulta é medido e visível (LLM/STT/tokens/vídeo) — NFR7.
2. Uso de silenciar (FR13) e Modo Foco (FR16) é medido por consulta (R3).
3. Taxa de aceite de sugestões e adoção em consulta são instrumentadas (PRD §9).
4. Latência fim-a-fim é monitorada em produção (§11).
5. Existe um gatilho/relatório que sinaliza quando ruído > 20% → recomendar default Quiet Board (frontend-spec §13.7).
6. Os dados permitem calibrar limiar (NFR1), rate-limit (NFR2) e pausa natural (A4) — O2/O3.

## Riscos Relevantes
- **R3 (distração) — Alta:** este épico é o juiz da hipótese "Board Ativo". A métrica de ruído (< 20%) é o sinal de produto que valida ou refuta a decisão central de UX. Sem ela, a escolha fica no escuro.
- **T2/R6 (custo) — Média:** sem instrumentação de custo/consulta, o gating de E4 não pode ser verificado nem a margem protegida.
- **Validade do piloto (R9):** amostra de design partners é pequena; tratar sinais como direcionais, não conclusivos.

## Stories Candidatas (esboço — detalhamento por @sm)
1. Instrumentação de custo por consulta (LLM/STT/tokens/vídeo) — NFR7 — *@dev · @architect*
2. Telemetria de uso de silenciar + Modo Foco + gatilho Quiet Board (R3) — *@dev · @architect*
3. Métricas de produto: taxa de aceite + adoção em consulta (PRD §9) — *@dev · @architect*
4. Telemetria de latência fim-a-fim em produção (§11) — *@dev · @architect*
5. Telemetria de calibração: dados para limiar/rate-limit/pausa (O2/O3) — *@dev · @architect*
