# E1 — Fundação & Compliance

> **Autor:** Morgan (@pm) · **Data:** 2026-06-09 · **Status:** Draft · **Tamanho:** XL
> **Fonte:** `docs/architecture.md` §13, §8, §11, ADR-001/006 · `docs/prd.md` §6, §8, §10
> **Depende de:** — (épico inicial, sem predecessores) · **Desbloqueia:** E2, E9 (e todos os demais indiretamente)

---

## Objetivo / Valor de Negócio

Estabelecer o esqueleto técnico do produto (monorepo full-stack TypeScript) e a **camada de compliance-by-design** (consentimento, criptografia de dados de saúde, trilha de auditoria) que é **inegociável** dado o risco regulatório CFM (R1) e LGPD (R2). Sem esta fundação, nenhuma story que toque dados reais de paciente pode ser feita com segurança jurídica. Entrega também a **camada de abstração de fornecedores** (`NFR8`), espinha dorsal sobre a qual STT/LLM/Vídeo se conectam — o seguro contra lock-in e custo.

## Descrição

Cria o monorepo (ADR-001), autenticação de usuário (nutrólogo), o serviço de consentimento de gravação (FR20), criptografia em repouso e trânsito de dados sensíveis (NFR9), o serviço de auditoria com proveniência (NFR10), os disclaimers persistentes de "IA assiste, médico decide" (FR19), as **interfaces de Provider Abstraction Layer** (`ISttProvider`/`ILlmProvider`/`IVideoAssetProvider`/`IKnowledgeRetriever` — contratos vazios/stubs, NFR8) e o pipeline de CI.

## Escopo

### IN
- Monorepo TypeScript (Next.js + serviços Node) — ADR-001.
- Autenticação do nutrólogo (login/sessão).
- **Consent Service:** captura e persiste consentimento de gravação (FR20).
- **Criptografia** em repouso e trânsito para dados de saúde (NFR9); modelo de dados base (USER, CONSULTATION, CONSENT, AUDIT_LOG — arquitetura §8).
- **Audit & Consent Service:** trilha de auditoria com proveniência (gatilho, fontes KB, versão de modelo) — NFR10.
- **Disclaimers persistentes** "IA assiste, médico decide" (FR19, componente `<DisclaimerNote>`).
- **Provider Abstraction Layer:** definição das 4 interfaces (contratos TS) — ADR-002 / NFR8. Apenas os contratos + 1 implementação stub/fake por interface para destravar testes.
- CI (lint, typecheck, test, build).
- Decisão de residência de dados no Brasil (LGPD) — documentar como ADR de follow-up.

### OUT
- Implementações reais de STT/LLM/Vídeo/RAG (ficam em E2/E5/E8).
- Telas funcionais do board (E7).
- Integração com EHR de terceiros `[A2]`.

## Requisitos Rastreados

- **FR:** FR19 (disclaimers), FR20 (consentimento)
- **NFR:** NFR8 (modularidade de fornecedores), NFR9 (LGPD/cripto/auditoria), NFR10 (postura CFM/auditoria)
- **ADR:** ADR-001 (monorepo), ADR-002 (provider abstraction), ADR-006 (compliance by design)
- **Riscos cobertos:** R1, R2, R8 (arquitetura pronta para receber base curada — interface IKnowledgeRetriever definida aqui)

## Dependências
- **Predecessores:** nenhum.
- **Sucessores diretos:** E2 (precisa do monorepo + ISttProvider), E9 (precisa de modelo de dados + auditoria).

## Critérios de Aceitação (alto nível)
1. Monorepo compila, lint/typecheck/test/build passam no CI.
2. Nutrólogo autentica e mantém sessão.
3. Consentimento de gravação é exigido e persistido antes de qualquer captura (FR20); sem consentimento, gravação é bloqueada.
4. Dados de saúde são criptografados em repouso e trânsito (NFR9), verificável por teste.
5. Toda escrita de dado clínico gera entrada de auditoria com proveniência (NFR10).
6. As 4 interfaces de provider existem com ≥ 1 implementação fake testável (NFR8).
7. Disclaimer "IA assiste, médico decide" presente e persistente na UI base (FR19).

## Riscos Relevantes
- **R1 (CFM) / R2 (LGPD) — Alta:** mitigação por design (ADR-006) + **item para consultoria jurídica antes de dados reais** (retenção de áudio/transcrição, base legal, residência de dados). Bloqueante para piloto com pacientes reais.
- **T7 (compliance mal feito):** validar criptografia e auditoria por teste automatizado, não só por inspeção.
- **Risco de over-engineering da abstração:** manter as interfaces mínimas (derivadas de NFR8/NFR5/NFR7), sem antecipar Fases 2/3.

## Stories Candidatas (esboço — detalhamento por @sm)
1. Setup do monorepo TypeScript + CI (lint/typecheck/test/build) — *executor: @dev · gate: @architect*
2. Autenticação do nutrólogo (login/sessão) — *@dev · @architect*
3. Modelo de dados base + criptografia em repouso/trânsito (NFR9) — *@data-engineer · @dev*
4. Consent Service: consentimento de gravação (FR20) — *@dev · @architect*
5. Audit & Consent Service: trilha de auditoria com proveniência (NFR10) — *@data-engineer · @dev*
6. Provider Abstraction Layer: 4 interfaces + fakes testáveis (NFR8) — *@architect · @dev*
7. Disclaimers persistentes "IA assiste, médico decide" (FR19) — *@ux-design-expert · @dev*
8. ADR de residência de dados BR + checklist de consultoria jurídica (R1/R2) — *@architect · @pm*
