# E8 — Vídeo das Personas

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** M
> **Fonte:** `docs/architecture.md` §13, §5, ADR-002/007 · `docs/prd.md` FR9, FR10, NFR6, NFR7, NFR8 · `docs/frontend-spec.md` §8 (coreografia) · `docs/personas-board.md`
> **Depende de:** E7 · **Desbloqueia:** E10

---

## Objetivo / Valor de Negócio

Entregar a **presença silenciosa das personas** — o "encantamento" que humaniza o board e sustenta o "uau" da demo, **a custo unitário controlado** (vídeo pré-renderizado, zero por consulta — NFR7, ADR-007). Implementa os 3 estados por persona (ouvindo / pensando / sinalizando) e a coreografia que reforça "foi ele que falou" (FR10), com **qualidade anti-uncanny-valley** (NFR6) que protege a credibilidade clínica (risco R4/T5). O avatar é encantamento; a base de conhecimento (E5) é o fosso — este épico entrega o primeiro sem inflar custo.

## Descrição

Implementa `IVideoAssetProvider` (catálogo pré-renderizado, **não** streaming em tempo real — ADR-007) que mapeia (persona × estado) → clipe, o **catálogo de clipes** (3 estados × 3 personas), o **pipeline de geração offline** dos loops, e a **coreografia de estados** no cliente (frontend-spec §8): só um doutor "sinaliza" por vez, ⚠️ tem prioridade de sinalização, acoplamento card↔vídeo, fallback estático em falha/reduced-motion. O provedor de geração de vídeo é um **open item** (O4) — especificar na execução.

## Escopo

### IN
- `IVideoAssetProvider`: `getClip(personaId, state)` → ClipRef (ADR-002, ADR-007).
- **Catálogo** (persona × estado) → clipe pré-renderizado em Object Storage.
- **Pipeline de geração offline** dos loops (3 estados × 3 personas) — custo único.
- `<DoctorVideoStrip>` / `<DoctorVideo>` / `<DoctorStatusBadge>` (frontend-spec §11).
- **Coreografia de estados** (frontend-spec §8): ouvindo (default) / pensando / sinalizando; máquina de estados; regras de sincronia anti-distração; acoplamento card↔vídeo (FR10).
- **Fallback estático** (retrato + badge) em falha de rede / `prefers-reduced-motion` — board 100% funcional sem vídeo.
- **Qualidade**: loops curtos/estáveis, consistência visual da mesma persona entre clipes (NFR6).
- Especificação do provedor de geração de vídeo (O4).

### OUT
- Avatar interativo em tempo real / streaming — Fase 3 (PRD OUT).
- Voz/TTS — Fase 2 (PRD OUT).
- Estado "Falando"/"Entrando no board" (não há voz; todos já ativos — PRD OUT).

## Requisitos Rastreados
- **FR:** FR9 (vídeos no painel — parte vídeo; feed é E7), FR10 (estados sinalizando/ouvindo/pensando + coreografia)
- **NFR:** NFR6 (qualidade anti-uncanny), NFR7 (custo unitário / pré-render), NFR8 (IVideoAssetProvider intercambiável)
- **ADR:** ADR-002 (abstração), ADR-007 (catálogo pré-renderizado)
- **Riscos cobertos:** T5 (uncanny valley), R4 (gimmick), R6 (custo unitário)
- **Open items endereçados:** O4 (provedor de geração de vídeo + pipeline)

## Dependências
- **Predecessores:** E7 (a faixa de vídeo encaixa no painel; até lá, placeholder/fallback estático).
- **Sucessores diretos:** E10 (custo de produção entra na conta de custo unitário).

## Critérios de Aceitação (alto nível)
1. Cada persona exibe 3 estados (ouvindo/pensando/sinalizando) via clipes pré-renderizados (FR10).
2. A persona que publica entra em "sinalizando" 3–5s, acoplada à entrada do card (FR10, frontend-spec §8.2).
3. Só um doutor sinaliza por vez; ⚠️ tem prioridade de sinalização (anti-distração).
4. Custo por consulta de vídeo = zero (pré-renderizado); custo é único de produção (NFR7, ADR-007).
5. Em falha de rede ou reduced-motion, fallback para avatar estático + badge, sem quebrar (NFR6/§8.3).
6. Consistência visual da mesma persona entre clipes (NFR6).
7. Trocar o provedor de vídeo = nova implementação de `IVideoAssetProvider` (NFR8).

## Riscos Relevantes
- **T5 (uncanny valley) — Média:** loops curtos/estáveis (NFR6); fallback estático; custo único permite iterar. A consistência entre clipes é o ponto crítico de qualidade.
- **R4 (gimmick) — Média:** o vídeo não pode ser o "produto"; é encantamento sobre a profundidade (E5). Evitar sobre-investir aqui em detrimento do fosso.
- **O4 (provedor de vídeo em aberto):** especificação pendente; risco de custo/qualidade do fornecedor — abstração NFR8 mitiga lock-in.

## Stories Candidatas (esboço — detalhamento por @sm)
1. `IVideoAssetProvider` + catálogo (persona × estado) em Object Storage (ADR-007) — *@dev · @architect*
2. Pipeline de geração offline dos loops + especificar provedor (O4) — *@analyst · @pm*
3. `<DoctorVideoStrip>`/`<DoctorVideo>`/`<DoctorStatusBadge>` (frontend-spec §11) — *@ux-design-expert · @dev*
4. Máquina de estados + coreografia de sincronia + acoplamento card↔vídeo (FR10) — *@dev · @ux-design-expert*
5. Fallback estático (falha de rede / reduced-motion) — *@ux-design-expert · @dev*
