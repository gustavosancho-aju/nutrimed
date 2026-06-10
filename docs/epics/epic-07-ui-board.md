# E7 — UI do Board

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** XL
> **Fonte:** `docs/architecture.md` §13, ADR-008 · `docs/prd.md` FR8–FR10, FR12–FR16, FR19, NFR3, NFR4, NFR11 · `docs/frontend-spec.md` (documento inteiro)
> **Depende de:** E3 (incremental) · **Desbloqueia:** E8, E10

---

## Objetivo / Valor de Negócio

Materializar a experiência "três colegas especialistas ao seu lado" — **presença máxima sem competir com o paciente**. Entrega o **painel lateral fixo**, os **4 tipos de contribuição** com hierarquia visual de segurança (NFR4 — o mecanismo de segurança, não decoração), os **controles do nutrólogo** (silenciar, expandir/perguntar, dispensar, fixar) e o **Modo Foco** (FR16 — a alavanca anti-distração primária contra o risco R3). É onde o produto vive ou morre na pergunta central: *o board ajuda sem roubar o contato visual com o paciente?*

## Descrição

Implementa a Tela de Consulta (grid 2 colunas + drawer no mobile) e todo o inventário de componentes do `frontend-spec` §11: `<BoardPanel>`, `<SuggestionFeed>` (2 regiões ARIA-live), `<SuggestionCard>` (4 tipos × micro-estados), `<SuggestionActions>`, `<SuggestionDetailPanel>`, `<AskDoctorInput>`, `<FocusModeToggle>`/`<FocusModeBanner>`, `<CriticalAlertRegion>`, `<MessageTypeLegend>`, lobby/onboarding. Implementa os **guarda-corpos de apresentação no cliente** (decaimento visual NFR3, fila de pausa, rate-limit visual — ADR-008), a **hierarquia visual de segurança** (NFR4), os **controles** (FR13–FR16) e a **acessibilidade WCAG 2.1 AA** com tratamento especial de alertas (frontend-spec §9). Consome os eventos do board (E3/E6) via `useBoardStream` → `useBoardStore`. Começa incremental a partir de E3 e evolui com E6.

## Escopo

### IN
- Tela de Consulta: grid 2 colunas, painel lateral fixo, drawer responsivo (frontend-spec §4, §10).
- **4 tipos de contribuição** com ícone/cor/label (⚠️/💡/🔍/📋) — FR8.
- **Painel: feed cronológico inverso + ⚠️ fixos no topo** (FR9 — parte feed; vídeos vêm de E8).
- **Hierarquia visual de segurança** em 5 dimensões; ⚠️ > 💡/🔍 > 📋 (NFR4).
- **Decaimento visual** do destaque (NFR3, A6 ~8s); micro-estados do card (frontend-spec §7).
- **Fila de pausa** + rate-limit visual no cliente (apresentação, ADR-008; lógica é E4).
- **Controles:** silenciar doutor (FR13), expandir + perguntar por texto (FR14, `<AskDoctorInput>`), dispensar ✓ + fixar 📌 (FR15), **Modo Foco** (FR16).
- **Renderização** de divergência/síntese/consolidado vindos de E6.
- **Disclaimers persistentes** na UI da consulta (FR19, complementa E1).
- **A11y WCAG 2.1 AA** + ARIA-live segmentado por severidade + `prefers-reduced-motion` (frontend-spec §9).
- Design tokens shadcn/Tailwind (frontend-spec §6) — `[A1]` cor-marca provisória.

### OUT
- Vídeos das personas e sua coreografia de estados — E8 (a faixa de vídeo é placeholder/fallback estático aqui).
- Lógica de score/rate-limit/dedup server-side — E4 (aqui só a *apresentação*).
- Síntese/divergência lógica — E6 (aqui só o render).

## Requisitos Rastreados
- **FR:** FR8 (4 tipos), FR9 (feed; vídeos em E8), FR10 (gatilho de estado de vídeo — disparo aqui, render em E8), FR12 (pausa — apresentação), FR13 (silenciar), FR14 (expandir/perguntar), FR15 (dispensar/fixar), FR16 (Modo Foco), FR19 (disclaimers)
- **NFR:** NFR3 (decaimento), NFR4 (hierarquia de segurança), NFR11 (PT-BR)
- **ADR:** ADR-008 (apresentação no cliente)
- **Riscos cobertos:** R3 (distração — Modo Foco + guarda-corpos visuais), A3 (WCAG AA)
- **Open items endereçados:** O6 (visual de estados — parcial; alta fidelidade Figma é próximo passo)

## Dependências
- **Predecessores:** E3 (eventos do board para renderizar; começa incremental).
- **Sucessores diretos:** E8 (vídeos preenchem a faixa), E10 (instrumenta uso de Modo Foco/silenciar).
- **Acopla com:** E6 (render de síntese/divergência), E4 (apresentação dos guarda-corpos).

## Critérios de Aceitação (alto nível)
1. Os 4 tipos de contribuição são distinguíveis por ícone + cor + label em ≤ 1s de relance (FR8, glanceability).
2. Feed cronológico inverso com ⚠️ fixos no topo até resolvidos (FR9).
3. ⚠️ tem precedência visual em todas as 5 dimensões; segurança nunca compete com sugestão comum (NFR4).
4. Destaque de 💡/🔍 decai após ~8s sem o card sumir (NFR3, A6).
5. Controles funcionam a 1 clique/tecla: silenciar (FR13), expandir/perguntar (FR14), dispensar/fixar com undo 5s (FR15), Modo Foco `F` (FR16).
6. A11y: ARIA-live `assertive` p/ ⚠️ e `polite` p/ resto; navegação 100% por teclado; `prefers-reduced-motion` sem perda de informação (WCAG 2.1 AA).
7. Disclaimer "IA assiste, médico decide" visível e persistente (FR19).

## Riscos Relevantes
- **R3 (distração) — Alta:** este épico é a principal defesa de UX; o sucesso só é confirmado no piloto (E10) medindo uso de Modo Foco/silenciar (meta < 20%). Se alto → default migra para "Quiet Board".
- **A11y de alertas — crítico:** um ⚠️ tem de ser percebido por leitor de tela e com reduced-motion, sem depender de cor/animação. Teste manual obrigatório (NVDA/VoiceOver).
- **`[A1]` identidade visual provisória:** tokens parametrizados; trocar a cor-marca é trivial. Alta fidelidade Figma é próximo passo.
- **`[A2]` desktop-first:** se houver uso real em tablet retrato, validar o drawer.

## Stories Candidatas (esboço — detalhamento por @sm)
1. `<ConsultationLayout>` grid 2 colunas + drawer responsivo + lobby/onboarding — *@ux-design-expert · @dev*
2. Design tokens shadcn/Tailwind (frontend-spec §6) — *@ux-design-expert · @dev*
3. `<SuggestionCard>`: 4 tipos + hierarquia visual de segurança (FR8, NFR4) — *@ux-design-expert · @dev*
4. `<SuggestionFeed>` cronológico inverso + ⚠️ fixos + 2 regiões ARIA-live (FR9) — *@ux-design-expert · @dev*
5. Micro-estados do card + decaimento visual + fila de pausa cliente (NFR3, A6, ADR-008) — *@dev · @ux-design-expert*
6. `<SuggestionActions>`: silenciar/expandir/dispensar/fixar + undo (FR13–FR15) — *@ux-design-expert · @dev*
7. `<SuggestionDetailPanel>` + `<AskDoctorInput>` (FR14) — *@ux-design-expert · @dev*
8. Modo Foco: toggle `F` + banner + fila represada escalonada (FR16) — *@ux-design-expert · @dev*
9. `<CriticalAlertRegion>` + render de divergência/síntese/consolidado de E6 (FR7 render) — *@dev · @ux-design-expert*
10. Acessibilidade WCAG 2.1 AA + ARIA-live + reduced-motion + testes jest-axe (A3) — *@ux-design-expert · @dev*
11. Disclaimers persistentes na tela de consulta (FR19) — *@ux-design-expert · @dev*
