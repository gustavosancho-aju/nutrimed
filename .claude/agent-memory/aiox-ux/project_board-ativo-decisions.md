---
name: board-ativo-decisions
description: Closed UX decisions for the NutriMed real-time specialist board — do not reopen
metadata:
  type: project
---

Decisões de UX **fechadas** (não reabrir) para o Board de Especialistas em tempo real, vindas do Atlas (`docs/board-ux-design.md`, `docs/personas-board.md`):

- **Board Ativo** (sugestões em tempo real com destaque) + **painel lateral fixo** (3 vídeos pequenos + feed).
- MVP **apenas texto** (sem voz). Vídeo das personas gerado por IA, presença silenciosa em loop, 3 estados: ouvindo / pensando / sinalizando.
- Hierarquia visual: ⚠️ atenção > 💡 sugestão / 🔍 hipótese > 📋 síntese. ⚠️ críticos fixam no topo e nunca decaem para fora.
- Controles: silenciar doutor, expandir, dispensar, fixar, Modo Foco.
- Princípio inegociável: **IA assiste, nutrólogo decide** (linguagem de sugestão, nunca comando) — proteção regulatória.

**Why:** Risco central de produto = distração na consulta real (atenção dividida com paciente). Todo design deve minimizar isso apesar do Board Ativo.

**How to apply:** A `docs/frontend-spec.md` (Uma) detalhou tokens, micro-estados de card, coreografia de vídeo, a11y (ARIA-live assertive p/ ⚠️), responsividade desktop-first. Itens em aberto que dependem de PILOTO com nutrólogos reais: limiar de relevância, rate-limit (default 2/min/doutor), def. de "pausa natural" (≥2,5s), decaimento (8s). Se taxa de uso de Modo Foco/silenciar > 20% no piloto → migrar default para "Quiet Board". Ver também [[nutrimed-scope]].
