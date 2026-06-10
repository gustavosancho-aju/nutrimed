---
name: project-nutrimed
description: What NutriMed is, its MVP scope, and the planning-doc chain (PRD → architecture → epics)
metadata:
  type: project
---

NutriMed é um board virtual de 3 especialistas de IA humanizados (Dr. Aurélio/nutrologia, Dr. Paulo/cardiologia, Dra. Yara/endocrinologia) que acompanham a consulta do nutrólogo ao vivo via transcrição em tempo real e sugerem proativamente por texto. MVP: só texto (sem voz/TTS), board sempre ativo, vídeo das personas pré-renderizado por IA, painel lateral fixo. Estratégia de nicho premium (clínicas de emagrecimento/longevidade). O fosso competitivo é a base de conhecimento clínica curada, NÃO o avatar.

**Why:** complexidade COMPLEX (23/25) — exige fundação de compliance (CFM/LGPD) + abstração de fornecedores antes de features, e walking skeleton antes de ampliar.

**How to apply:** A cadeia de docs de planejamento vive em `docs/`: `prd.md` (FR1–FR21, NFR1–NFR12), `architecture.md` (ADRs, §13 particionamento em épicos), `frontend-spec.md`, `personas-board.md`, `personas-knowledge-base-seed.md`, `market-research.md`. Backlog de épicos formal em `docs/epics/` (README index + epic-01..10). Existe um segundo módulo (Composição Corporal por Foto, `docs/prd-body-composition-mvp.md`) fora do escopo do board e não priorizado. Projeto é greenfield, sem repositório git.
