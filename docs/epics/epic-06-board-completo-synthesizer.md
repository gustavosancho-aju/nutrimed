# E6 — Board completo + Synthesizer

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** L
> **Fonte:** `docs/architecture.md` §13, §3, §4 · `docs/prd.md` FR2, FR6, FR7, FR11, FR18, NFR10, NFR12 · `docs/personas-board.md` (dinâmica do board)
> **Depende de:** E4, E5 · **Desbloqueia:** E10

---

## Objetivo / Valor de Negócio

Entregar o **produto completo do board**: as **3 personas ativas simultaneamente** (FR2) com a dinâmica de tensão saudável (Yara aprofunda ↔ Aurélio integra ↔ Paulo protege), o **Synthesizer (papel do Aurélio)** que consolida e fecha a recomendação devolvendo a decisão ao médico (FR6), e a **divergência transparente** quando duas personas discordam (FR7) — que o PRD define como *feature, não bug*. É o que transforma 3 motores isolados em "três colegas especialistas ao seu lado" e sustenta o "uau" clínico da demo (NFR12).

## Descrição

Ativa as 3 personas (Aurélio, Paulo, Yara) sobre o mesmo stream, combinando E4 (gating) + E5 (reasoning). Implementa o **Synthesizer**: Aurélio abre a rodada, organiza o raciocínio e ao final sintetiza Yara + Paulo numa recomendação única (FR6), sempre marcando que a decisão é do médico (NFR10). Trata **divergência** (expõe transparentemente, Aurélio modera — FR7) e **consolidação** entre personas (dedup multi-persona — FR11, complementa E4). Suporta **síntese sob demanda** além da automática ao fim da rodada (FR18).

## Escopo

### IN
- 3 personas ativas desde o início, monitorando continuamente (FR2 completo).
- Dinâmica do board: Aurélio abre → Yara investiga → Paulo avalia risco → Aurélio sintetiza (`[PB]`).
- **Synthesizer (Aurélio):** consolida contribuições de Yara/Paulo em recomendação única; devolve decisão ao médico (FR6, NFR10).
- **Divergência transparente:** quando 2 personas divergem, expor com Aurélio moderando, marcando "escolha é do médico" (FR7) — base para o card multi-avatar.
- **Consolidação multi-persona** (mesmo ponto por 2 doutores → 1 card) — FR11 no nível do board.
- **Síntese sob demanda** + síntese automática ao fim da rodada (FR18).

### OUT
- Apresentação visual da divergência/síntese/consolidação no feed — E7 (este épico produz o evento; E7 renderiza).
- Calibração fina da dinâmica com médicos reais — E10/piloto.

## Requisitos Rastreados
- **FR:** FR2 (3 personas), FR6 (abertura/síntese Aurélio), FR7 (divergência transparente), FR11 (consolidação multi-persona), FR18 (síntese sob demanda)
- **NFR:** NFR10 (decisão é do médico — auditada), NFR12 (uau de demo)
- **Riscos cobertos:** R4 (valor na profundidade, não no avatar — a síntese clínica é o valor)

## Dependências
- **Predecessores:** E4 (motores/gating) **e** E5 (RAG/reasoning) — convergência das duas trilhas paralelas.
- **Sucessores diretos:** E10 (observabilidade/piloto mede o board completo).
- **Acopla com:** E7 (renderiza divergência/síntese/consolidado).

## Critérios de Aceitação (alto nível)
1. As 3 personas operam simultaneamente sobre o mesmo stream sem invocação (FR2).
2. Aurélio abre a rodada e produz uma síntese única ao final, sempre devolvendo a decisão ao médico (FR6, NFR10).
3. Quando Yara e Paulo divergem, a divergência é exposta transparentemente, com Aurélio moderando (FR7).
4. Pontos redundantes entre personas são consolidados em 1 contribuição no nível do board (FR11).
5. A síntese pode ser gerada sob demanda além da automática (FR18).
6. Toda síntese/contribuição mantém trilha de auditoria de proveniência (NFR10, via E1).

## Riscos Relevantes
- **R4 (ceticismo/gimmick) — Média:** o valor tem de estar na profundidade da síntese clínica; depende da qualidade da semente (E5) e da curadoria (trilha transversal).
- **Latência composta:** 3 personas + síntese aumentam o custo/latência — o gating de E4 é o que mantém viável; medir em E10.
- **Coerência da divergência:** divergência precisa ser *informativa*, não confusa — validar UX com E7 e no piloto.

## Stories Candidatas (esboço — detalhamento por @sm)
1. Ativar 3 personas simultâneas no orchestrator (FR2) — *@architect · @pm*
2. Synthesizer (Aurélio): consolidação + recomendação única + decisão do médico (FR6, NFR10) — *@dev · @architect*
3. Divergência transparente entre personas (FR7) — *@dev · @architect*
4. Consolidação multi-persona / card de concordância (FR11 nível board) — *@dev · @architect*
5. Síntese sob demanda + automática ao fim da rodada (FR18) — *@dev · @architect*
