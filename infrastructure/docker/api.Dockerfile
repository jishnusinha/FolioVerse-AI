# syntax=docker/dockerfile:1.7
# NestJS API (http + worker share this image). Non-root, production dependencies only.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @folioverse/api... --ignore-scripts
COPY packages/shared-config packages/shared-config
COPY apps/api apps/api
# tsconfig.build.json includes prisma/, so the build emits dist/src/** and dist/prisma/seed.js.
RUN cd apps/api && npx prisma generate && npx nest build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @folioverse/api deploy --prod /out && cp -r apps/api/dist /out/dist && cd /out && npx prisma generate

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production FV_SKIP_DOTENV=1 FV_MODEL_REGISTRY_SEED=/app/config/models/registry.seed.yaml \
    FV_REC_CATALOG=/app/data/catalog/catalog.jsonl
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --chown=node:node config/models /app/config/models
# Synthetic DEMO catalog; the seed loads it only when FV_DEMO_CATALOG=true.
COPY --chown=node:node datasets/synthetic/catalog /app/data/catalog
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
