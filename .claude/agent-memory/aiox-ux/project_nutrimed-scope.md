---
name: nutrimed-scope
description: NutriMed has two distinct modules that must not be mixed in UX/spec work
metadata:
  type: project
---

NutriMed contém **dois produtos/módulos distintos** com contextos de uso opostos:

1. **Board de Especialistas em tempo real** (núcleo) — tela de consulta no consultório, 3 IAs humanizadas (Aurélio/nutro, Paulo/cardio, Yara/endo) acompanham via transcrição ao vivo e sugerem por texto. Contexto: desktop, médico com atenção dividida. Spec em `docs/frontend-spec.md`.
2. **Módulo de Composição Corporal por Foto** (entre-consultas) — captura mobile pelo paciente, gráfico de evolução/tendência. PRD em `docs/prd-body-composition-mvp.md`.

**Why:** O handoff do Atlas para a frontend-spec era só o item 1, mas o PRD que existe em docs/ é do item 2 — fácil confundir.

**How to apply:** Ao criar specs/wireframes, manter arquivos separados (ex.: `frontend-spec-body-composition.md` quando aquele épico for priorizado). Contexto de uso é oposto (consultório desktop ao vivo vs. celular do paciente). Stack ativo do projeto: Next.js 16+/React/TS/Tailwind/shadcn/ui/Zustand/React Query. Projeto é greenfield (sem componentes nem icon-map ainda).
