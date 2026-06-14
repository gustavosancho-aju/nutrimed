# syntax=docker/dockerfile:1.7
##
## NutriMed — imagem de produção (ADR-010: servidor Node long-lived single-process)
##
## Build do monorepo pnpm (19 pacotes) → build do app Next (apps/web) → runtime
## Node slim, não-root, com Next standalone + o gateway WS (porta BOARD_WS_PORT).
##
## Coerência arquitetural:
##  - NÃO é serverless. O processo fica vivo; o BoardGateway (WS /board e /audio)
##    e o estado de sessão (Map em memória) vivem DENTRO deste processo (ADR-010).
##  - Portátil: nada amarrado a Fly; migrável a AWS sa-east-1 etc. (ADR-009).
##  - Sem devDeps no runtime; cache de layers do pnpm via store montado.
##
## Portas expostas: 3000 (HTTP do Next) + 3001 (WS do board, BOARD_WS_PORT).
##

ARG NODE_VERSION=22

############################
# Stage 1 — base com pnpm  #
############################
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# pnpm@10.4.1 = packageManager fixado no package.json raiz
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app

#####################################
# Stage 2 — deps (cache de install) #
#####################################
# Copia só os manifestos para maximizar o cache: só reinstala se um package.json
# ou o lockfile mudar.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ packages/
# (os packages são copiados inteiros aqui só pelos seus package.json; o código
#  fonte vem no stage de build. Manter assim é simples e correto para o monorepo.)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

############################
# Stage 3 — build          #
############################
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# node_modules já resolvidos
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
# código completo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
# build de todos os pacotes (pnpm -r build) — pré-requisito do app web
RUN pnpm build
# poda devDependencies para o runtime
RUN pnpm prune --prod

############################
# Stage 4 — runtime        #
############################
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next escuta nessa porta; o WS do board usa BOARD_WS_PORT (default 3001).
ENV PORT=3000
ENV BOARD_WS_PORT=3001
ENV HOSTNAME=0.0.0.0

# usuário não-root
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nutrimed

WORKDIR /app

# App + workspace já buildado e podado. Copiamos o workspace inteiro porque o
# app Next resolve os pacotes @nutrimed/* via symlinks do pnpm em node_modules.
COPY --from=build --chown=nutrimed:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nutrimed:nodejs /app/packages ./packages
COPY --from=build --chown=nutrimed:nodejs /app/apps/web ./apps/web
COPY --from=build --chown=nutrimed:nodejs /app/package.json ./package.json
COPY --from=build --chown=nutrimed:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# A SEED da base de conhecimento (E5) é lida em runtime por board-runtime.ts:
#   join(process.cwd(), '..', '..', 'docs', 'personas-knowledge-base-seed.md')
# cwd em runtime = /app/apps/web → resolve para /app/docs/...
COPY --from=build --chown=nutrimed:nodejs /app/docs/personas-knowledge-base-seed.md ./docs/personas-knowledge-base-seed.md

USER nutrimed

EXPOSE 3000 3001

# Healthcheck: o app Next responde em 3000. (O WS só sobe na primeira renderização
# de uma consulta — ver RUNBOOK §"Bloqueador do WS"; o healthcheck cobre o HTTP.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/web
# `next start` mantém o processo vivo; o BoardGateway vive no mesmo processo
# (singleton globalThis.__nutrimedBoard). Ver RUNBOOK para o aviso de warm-up do WS.
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
