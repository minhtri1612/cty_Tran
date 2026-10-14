FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN npm ci && npx prisma generate && npx tsc

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY index.html ./
COPY static ./static
ENV PORT=4173
EXPOSE 4173
CMD ["sh", "-c", "npx prisma db push && node dist/server.js"]
