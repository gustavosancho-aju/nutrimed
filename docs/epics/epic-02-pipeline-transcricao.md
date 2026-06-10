# E2 — Pipeline de Transcrição

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** L
> **Fonte:** `docs/architecture.md` §13, §4, §5, §11, ADR-002 · `docs/prd.md` FR1, NFR5, NFR8, NFR11 · `docs/frontend-spec.md` §11 (`<TranscriptPanel>`)
> **Depende de:** E1 · **Desbloqueia:** E3, E9
> **🟡 PRÉ-REQUISITO DA POC DE LATÊNCIA/CUSTO (com E3)**

---

## Objetivo / Valor de Negócio

Entregar a **transcrição da consulta ao vivo em PT-BR** (FR1) — o input fundamental de todo o board. Implementa a primeira concretização da Provider Abstraction (`ISttProvider`) e **valida, com áudio clínico real e ≥ 2 candidatos de fornecedor, a latência fala→texto (NFR5) e a precisão com jargão médico** (risco T4). É metade da POC que decide a stack de runtime antes de comprometer features caras.

## Descrição

Implementa `ISttProvider` (streaming PT-BR, segmentos parciais e finais), o consumo do stream pelo Consultation Session Service (estado da sessão em memória), e o display da transcrição (`<TranscriptPanel>` com auto-follow scroll). O áudio para STT usa o SDK/stream do próprio provider (não trafega pelo WS do board — arquitetura §7). Estado degradado gracioso em falha de transcrição (banner "transcrição instável", sem travar a consulta — frontend-spec §3.1).

## Escopo

### IN
- `ISttProvider` real: `openStream({ lang: 'pt-BR' })` → segmentos parciais + finais (arquitetura §5).
- Captura de áudio no cliente + checagem de microfone (lobby pré-consulta).
- Consultation Session Service: acumula transcript da sessão (estado em memória, ADR-005 — validar runtime na POC).
- `<TranscriptPanel>`: display ao vivo com auto-follow, estados streaming/pausado/erro.
- **Avaliação de ≥ 2 candidatos de STT** sobre áudio clínico real; medição de latência (NFR5) e precisão de termos médicos (T4).
- Tratamento de parciais e vocabulário/boost de termos clínicos.

### OUT
- Motores do board (trigger/score) — E4.
- Personas/contribuições — E3/E5.
- Nota clínica estruturada — E9 (consome a transcrição daqui).

## Requisitos Rastreados
- **FR:** FR1 (transcrição PT-BR em tempo real)
- **NFR:** NFR5 (latência), NFR8 (ISttProvider intercambiável), NFR11 (PT-BR)
- **ADR:** ADR-002 (abstração), ADR-005 (orchestrator/sessão stateful — validar)
- **Riscos cobertos:** T4 (STT PT-BR clínico), T1 (latência — medição inicia aqui)
- **Open items endereçados:** parte de O5 (áudio clínico real para teste)

## Dependências
- **Predecessores:** E1 (monorepo + ISttProvider interface + auth/consent).
- **Sucessores diretos:** E3 (board consome a transcrição), E9 (nota clínica deriva da transcrição).

## Critérios de Aceitação (alto nível)
1. Áudio do consultório é transcrito ao vivo em PT-BR e exibido no `<TranscriptPanel>` (FR1, NFR11).
2. Trocar de fornecedor STT = nova implementação de `ISttProvider`, sem tocar no domínio (NFR8).
3. Latência fala→texto medida e documentada para ≥ 2 candidatos (NFR5); meta de referência ~1–2s (§11).
4. Precisão com jargão médico avaliada sobre áudio clínico real (T4); termos críticos não são sistematicamente perdidos.
5. Falha do STT em runtime degrada graciosamente (banner, sem travar) — frontend-spec §3.1.
6. Sem permissão de microfone, o início é bloqueado com instrução clara.

## Riscos Relevantes
- **T4 (precisão STT PT-BR clínico) — Alta para o produto:** gatilhos do board dependem da transcrição; erro aqui propaga. Mitigar com teste em áudio real + boost de vocabulário.
- **T1 (latência) — Alta:** se STT domina o orçamento de latência, inviabiliza sugestões úteis. Medição é entregável obrigatório.
- **T8 (sessão stateful):** confirma/refuta ADR-005 (orchestrator stateful) na POC.

## Stories Candidatas (esboço — detalhamento por @sm)
1. Implementar `ISttProvider` real com streaming PT-BR (parciais/finais) — *@dev · @architect*
2. Captura de áudio + checagem de microfone no lobby — *@dev · @architect*
3. Consultation Session Service: acúmulo de transcript em memória — *@dev · @architect*
4. `<TranscriptPanel>` com auto-follow e estados (streaming/pausado/erro) — *@ux-design-expert · @dev*
5. POC: avaliar ≥ 2 candidatos STT em áudio clínico real (latência NFR5 + precisão T4) — *@analyst · @pm*
6. Degradação graciosa + boost de vocabulário clínico — *@dev · @architect*
