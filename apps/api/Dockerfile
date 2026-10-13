FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
# Prisma engine binaries: binaries.prisma.sh is often unreachable from CN/HK hosts;
# use the npmmirror binary mirror instead (honored by `prisma generate`).
ENV PRISMA_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

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
# 无头浏览器截图：offer-fetch 第二级抓取用（puppeteer-core + 系统 chromium，不下载浏览器）
# 阿里云 Alpine 镜像源：HK/CN 服务器直连 dl-cdn.alpinelinux.org 慢或半死不活（2026-10-13 构建卡 50 分钟）
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache chromium
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Default: HTTP API. Worker: `node dist/worker.js`. Migrate: see docker-compose migrate service.
CMD ["node", "dist/server.js"]
