# E9 — Documentação Clínica

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** S
> **Fonte:** `docs/architecture.md` §13, §3 (Documentation Service) · `docs/prd.md` FR17, §5 (item 11), A1, O7
> **Depende de:** E2 · **Desbloqueia:** —

---

## Objetivo / Valor de Negócio

Entregar a **paridade mínima com o mercado** — documentação básica da consulta — como **facilitador de adoção** (`[MR]` Opportunity 2). O nutrólogo carrega ~2h/dia de sobrecarga administrativa; uma transcrição estruturada + nota clínica editável reduz fricção e ajuda a justificar o ticket premium, sem desviar foco do diferencial (o board). Escopo deliberadamente **enxuto** (`[A1]`): transcrição estruturada + nota clínica simples editável, deixando SOAP/template avançado para iteração.

## Descrição

Implementa o **Documentation Service** (arquitetura §3) que, a partir da transcrição acumulada (E2), gera uma **transcrição estruturada + nota clínica editável** (FR17). A profundidade exata (SOAP completo vs. nota simples) é uma suposição de produto a validar com design partners (`[A1]`, `[O7]`) — o MVP entrega a versão simples. Inclui a Tela de Síntese/Nota Clínica (revisão e edição pós-consulta).

## Escopo

### IN
- Documentation Service: gera transcrição estruturada da consulta a partir do stream (FR17).
- **Nota clínica simples editável** (`[A1]`) pós-consulta.
- Tela de Síntese / Nota Clínica (revisão e edição) — frontend-spec/PRD §7.
- Persistência da nota (criptografada + auditada — via E1).

### OUT
- **SOAP automático completo / template clínico avançado** — iteração futura (`[A1]`, `[O7]`).
- Integração com EHR/prontuário de terceiros — `[A2]` (PRD OUT).
- Incorporação da síntese do board na nota (a síntese vem de E6; a *integração* pode ser story de follow-up).

## Requisitos Rastreados
- **FR:** FR17 (documentação básica: transcrição estruturada + nota clínica editável)
- **NFR:** NFR9/NFR10 (nota é dado de saúde — cripto/auditoria via E1)
- **Assumptions:** A1 (nota simples, não SOAP completo)
- **Open items endereçados:** O7 (validar profundidade da documentação com design partners)

## Dependências
- **Predecessores:** E2 (a transcrição é o insumo da nota).
- **Sucessores diretos:** nenhum (folha do grafo).
- **Acopla com:** E1 (persistência criptografada/auditada), E6 (síntese do board — integração opcional futura).

## Critérios de Aceitação (alto nível)
1. Ao encerrar a consulta, o sistema gera uma transcrição estruturada da consulta (FR17).
2. O nutrólogo pode editar uma nota clínica simples derivada da consulta (FR17, A1).
3. A nota é persistida com criptografia e auditoria (NFR9/NFR10, via E1).
4. A profundidade entregue é a "simples" do `[A1]`; SOAP avançado fica fora (escopo controlado).

## Riscos Relevantes
- **O7/A1 (profundidade indefinida) — Baixa-Média:** entregar o mínimo viável e validar com design partners antes de investir em SOAP. Evitar scope creep para template clínico completo.
- **Commodity:** documentação é paridade, não diferencial — não sobre-investir; o valor está no board.

## Stories Candidatas (esboço — detalhamento por @sm)
1. Documentation Service: transcrição estruturada da consulta (FR17) — *@dev · @architect*
2. Nota clínica simples editável + persistência cripto/auditada (FR17, A1) — *@dev · @architect*
3. Tela de Síntese / Nota Clínica (revisão e edição pós-consulta) — *@ux-design-expert · @dev*
