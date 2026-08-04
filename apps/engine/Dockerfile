# Build context must be the monorepo root (Railway Root Directory = empty / ".")
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/engine/package.json ./apps/engine/

RUN pnpm install --frozen-lockfile=false --filter @snapline/engine...

# Bump CACHEBUST whenever health/listen changes so Railway cannot reuse a stale engine layer
ARG CACHEBUST=health-2026-08-04-c
RUN echo "cachebust=$CACHEBUST"

COPY packages/shared ./packages/shared
COPY apps/engine ./apps/engine

RUN pnpm --filter @snapline/shared build \
 && pnpm --filter @snapline/engine build \
 && test -f /app/apps/engine/dist/index.js \
 && node -e "console.log('engine entry ok', require('fs').statSync('/app/apps/engine/dist/index.js').size)"

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 8080

WORKDIR /app/apps/engine

# Absolute path — independent of Railway start cwd
CMD ["node", "/app/apps/engine/dist/index.js"]
