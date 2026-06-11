# NutriMed

Monorepo full-stack TypeScript do NutriMed — board de especialistas clínicos assistido por IA
("a IA assiste, o médico decide"). Este repositório contém o **esqueleto técnico** (Story 1.1):
estrutura de workspaces, qualidade automatizada e pipeline de CI. As features de produto
(compliance, abstração de fornecedores, board) são construídas sobre esta fundação.

## Stack

- **Gerenciador de pacotes:** pnpm workspaces (Node ≥ 18)
- **Frontend:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4
- **Domínio/serviços:** pacotes Node/TypeScript com tipos compartilhados
- **Qualidade:** ESLint (flat config) + typescript-eslint · Prettier
- **Testes:** Vitest
- **CI:** GitHub Actions (`lint → typecheck → test → build`)

## Estrutura

```
.
├── apps/
│   └── web/                 # App Next.js (App Router)
├── packages/
│   ├── domain/              # Lógica de domínio/serviços
│   └── shared-types/        # Tipos TypeScript compartilhados (frontend ↔ serviços)
├── eslint.config.mjs        # ESLint flat config (raiz, todos os workspaces)
├── tsconfig.base.json       # Config TS base herdada pelos workspaces
├── vitest.config.ts         # Runner de testes (raiz)
└── .github/workflows/ci.yml # Pipeline de CI
```

Imports entre pacotes usam os nomes de workspace (`@nutrimed/shared-types`, `@nutrimed/domain`)
e, dentro de `apps/web`, o alias `@/*` — sem caminhos relativos profundos (`../../..`),
conforme a Constitution (Art. VI — Absolute Imports).

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+ (testado em 22)
- [pnpm](https://pnpm.io/) 10+ (`npm install -g pnpm` ou `corepack enable`)

## Instalação

```bash
pnpm install
```

## Comandos

Todos rodam a partir da raiz e abrangem todos os workspaces:

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | Sobe o app web (Next.js) em modo desenvolvimento |
| `pnpm lint` | ESLint em todo o monorepo |
| `pnpm typecheck` | `tsc --noEmit` por workspace |
| `pnpm test` | Suíte de testes (Vitest) |
| `pnpm build` | Build de todos os pacotes + app web |
| `pnpm format` | Verifica formatação (Prettier) do código em `apps/` e `packages/` |

## CI

O workflow `.github/workflows/ci.yml` executa `lint → typecheck → test → build` em cada
`push` e `pull_request`, e **falha o check** se qualquer etapa falhar.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores. **Nunca** versione `.env` — ele já
está coberto pelo `.gitignore`.

```bash
cp .env.example .env
```

---

> Fundação criada na Story 1.1. shadcn/ui será adicionado quando o primeiro componente de UI
> for necessário (ver Épico 7 / Story 1.7).
