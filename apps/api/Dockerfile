FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
WORKDIR /app
RUN pnpm --filter @adlinklab/shared build \
 && pnpm --filter @adlinklab/domain build \
 && pnpm --filter @adlinklab/google-ads build \
 && pnpm --filter @adlinklab/tracking build \
 && pnpm --filter @adlinklab/offers build \
 && pnpm --filter @adlinklab/conversions build \
 && pnpm --filter @adlinklab/traffic build \
 && pnpm --filter @adlinklab/database generate \
 && pnpm --filter @adlinklab/database build \
 && pnpm --filter @adlinklab/api build

# Shared image for API server, Worker, and one-shot migrate.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Default: HTTP API. Worker: `node dist/worker.js`. Migrate: see docker-compose migrate service.
CMD ["node", "dist/server.js"]
