# Build context must be the monorepo root (Railway Root Directory = empty / ".")
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/engine/package.json ./apps/engine/

# Install engine + workspace deps only (skips Next/Privy web tree)
RUN pnpm install --frozen-lockfile=false --filter @snapline/engine...

COPY packages/shared ./packages/shared
COPY apps/engine ./apps/engine

RUN pnpm --filter @snapline/shared build \
 && pnpm --filter @snapline/engine build

WORKDIR /app/apps/engine
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 8080

# Absolute path so Railway startCommand / cwd cannot miss dist/
CMD ["node", "/app/apps/engine/dist/index.js"]
