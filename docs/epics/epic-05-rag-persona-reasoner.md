# E5 — RAG & Persona Reasoner

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** L
> **Fonte:** `docs/architecture.md` §13, §5, §6, ADR-002/004 · `docs/prd.md` FR3, FR21, NFR8, NFR11, R8 · `docs/personas-knowledge-base-seed.md` (semente/escopos) · `docs/personas-board.md`
> **Depende de:** E3 · **Desbloqueia:** E6

---

## Objetivo / Valor de Negócio

Construir o motor que dá **profundidade clínica** às contribuições — o que a estratégia define como o **fosso real** (a base curada é o diferencial, não o avatar). Implementa o **RAG com namespaces isolados por persona** (FR21), garantindo que cada doutor só raciocine dentro da sua especialidade (impede o cardiologista de "inventar" endocrinologia — risco T6), e o **Persona Reasoner** que gera a contribuição em texto via LLM com contexto recuperado. Prepara a **substituição da semente pela base curada sem retrabalho** (R8) via re-ingestão.

## Descrição

Implementa `IKnowledgeRetriever` real (ADR-002) sobre um vector store com **namespaces por persona** (Aurélio/ABRAN, Paulo/SBC, Yara/SBEM — arquitetura §6), o **pipeline de ingestão versionado** da semente (`personas-knowledge-base-seed.md`) com proveniência por chunk (fonte/versão — defesa de auditoria), e o **Persona Reasoner** que, após o Gate de E4 aprovar um candidato, recupera KB do escopo da persona e gera a contribuição via `ILlmProvider` restrita à especialidade (FR21). A qualidade do *conteúdo* curado é trabalho clínico (trilha transversal), fora deste épico.

## Escopo

### IN
- `IKnowledgeRetriever` real: `retrieve(personaId, query, k)` restrito ao namespace da persona (FR21).
- Vector store com **namespaces isolados por persona** (ADR-004).
- **Pipeline de ingestão versionado** da semente, com proveniência por chunk (fonte/versão).
- **Persona Reasoner:** LLM + contexto RAG escopado → contribuição em texto PT-BR (FR3, NFR11).
- Prompts restritos por persona (system + escopo) para evitar extrapolação (T6).
- Mecanismo de re-ingestão: trocar conteúdo = re-ingestão, não mudança de código (R8).

### OUT
- Synthesizer / divergência / 3 personas integradas — E6 (este épico entrega o raciocínio de 1 persona como peça; a orquestração das 3 é E6).
- Curadoria do conteúdo clínico definitivo — trilha transversal (`[O1]`), não engenharia.
- Trigger/score/gate — E4 (o Reasoner é chamado *após* o gate).

## Requisitos Rastreados
- **FR:** FR3 (geração da contribuição), FR21 (escopo por persona / namespaces)
- **NFR:** NFR8 (IKnowledgeRetriever intercambiável), NFR11 (PT-BR)
- **ADR:** ADR-002 (abstração), ADR-004 (RAG namespaces + seed→curada)
- **Riscos cobertos:** T6 (RAG alucina/extrapola especialidade), R8 (base curada ainda não existe)
- **Open items endereçados:** O1 (arquitetura pronta para receber base curada)

## Dependências
- **Predecessores:** E3 (orchestrator + ILlmProvider provado na POC).
- **Sucessores diretos:** E6 (board completo + síntese usa os 3 reasoners).
- **Acopla com:** E4 (Reasoner roda só após o Gate aprovar).

## Critérios de Aceitação (alto nível)
1. Cada persona recupera **apenas** do seu namespace; um query no escopo de cardio não traz chunks de endo (FR21).
2. A semente é ingerida por pipeline versionado; cada chunk guarda proveniência (fonte/versão).
3. O Persona Reasoner gera contribuição em texto PT-BR ancorada no contexto recuperado (FR3, NFR11).
4. Trocar o retriever/LLM = nova implementação de interface, sem tocar no domínio (NFR8).
5. Substituir a semente pela base curada é **re-ingestão**, não mudança de código (R8).
6. Prompts restritos impedem que a persona responda fora da sua especialidade (T6), verificável por teste de extrapolação.

## Riscos Relevantes
- **T6 (alucinação/extrapolação) — Média:** namespaces + proveniência + prompts restritos; revisão clínica da curadoria é da trilha transversal, não daqui.
- **R8 (sem base curada no MVP) — Média:** a semente valida o mecanismo e a demo; a arquitetura precisa receber a base curada sem retrabalho — testar a re-ingestão como AC.
- **Custo/latência do RAG:** recuperação adiciona latência ao caminho — medir junto com E3/§11.

## Stories Candidatas (esboço — detalhamento por @sm)
1. `IKnowledgeRetriever` real + vector store com namespaces por persona (FR21, ADR-004) — *@data-engineer · @dev*
2. Pipeline de ingestão versionado da semente + proveniência por chunk (R8) — *@data-engineer · @dev*
3. Persona Reasoner: LLM + contexto RAG escopado → contribuição PT-BR (FR3) — *@dev · @architect*
4. Prompts restritos por persona (anti-extrapolação, T6) — *@dev · @architect*
5. Mecanismo de re-ingestão seed→curada sem mudança de código (R8) — *@data-engineer · @dev*
