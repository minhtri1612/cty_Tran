# syntax=docker/dockerfile:1
# Pinned base image. Multi-arch: builds natively on amd64 and arm64 (Graviton),
# and Prisma downloads the matching query engine during `npm ci`.
FROM node:22.22.1-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
# Generates the Prisma client and type-checks/compiles TypeScript.
RUN npm run build && npm prune --omit=dev

FROM node:22.22.1-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    PORT=4173 \
    SCM_HOST=0.0.0.0 \
    SCM_DB_PATH=/data/hoang-nhat.sqlite3 \
    TRUST_PROXY=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
# Production dependencies include the generated client and the Prisma CLI
# (needed for `npm run db:migrate`).
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json package-lock.json index.html ./
COPY --chown=root:root prisma ./prisma
COPY --chown=root:root scripts ./scripts
COPY --chown=root:root static ./static
# Application files are owned by root and read-only for the app user; only
# /data (the mounted SQLite directory) is writable.
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# No schema changes on startup: the server refuses to start until
# `docker compose run --rm app npm run db:migrate` has been run (see README).
CMD ["node", "dist/server.js"]
