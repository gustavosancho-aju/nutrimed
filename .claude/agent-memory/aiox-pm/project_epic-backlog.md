---
name: project-epic-backlog
description: NutriMed E1–E10 epic backlog — order, sizing, the POC gate, and recommended start
metadata:
  type: project
---

Backlog formal de 10 épicos criado em `docs/epics/` (índice em `docs/epics/README.md`), derivado de `docs/architecture.md` §13. Ordem por dependência: E1 Fundação & Compliance (XL) → E2 Pipeline de Transcrição (L) → E3 Walking Skeleton (M) → E4 Motores (L) e E5 RAG (L) em paralelo → E6 Board completo + Synthesizer (L) → E7 UI (XL, incremental a partir de E3) → E8 Vídeo (M) → E9 Documentação Clínica (S, depende de E2) → E10 Observabilidade & Piloto (M).

**Why:** compliance é fundação não-negociável (R1/R2/ADR-006) e a abstração de fornecedores (NFR8) é espinha dorsal — por isso E1 é o ponto de partida. E2+E3 são marcados como a POC de latência/custo recomendada pela arquitetura (§14), a rodar com ≥2 candidatos de STT e LLM antes de comprometer E4/E5/E6.

**How to apply:** Próximo passo é @sm `*draft` por story (começar por E1) e @po `*validate-story-draft`. Cada epic file tem stories candidatas esboçadas com executor/quality-gate sugeridos — não são stories detalhadas (isso é trabalho do @sm). Toda afirmação rastreia FR/NFR/ADR (Article IV); suposições marcadas [A1]..[A6]/[ASSUMPTION].
