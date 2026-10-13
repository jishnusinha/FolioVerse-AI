# syntax=docker/dockerfile:1.7
# NestJS API (http + worker + migrate share this image). Non-root, production dependencies only,
# runs on a read-only root filesystem (writable /tmp only).
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
# The Prisma CLI is a production dependency so the migrate job runs the locked version offline.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @folioverse/api deploy --prod /out && cp -r apps/api/dist /out/dist && cd /out && node_modules/.bin/prisma generate

FROM node:22-slim AS runtime
# npm, npx and corepack are not needed at runtime; removing them shrinks the scanned surface.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production FV_SKIP_DOTENV=1 HOME=/tmp CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    FV_MODEL_REGISTRY_SEED=/app/config/models/registry.seed.yaml \
    FV_REC_CATALOG=/app/data/catalog/catalog.jsonl FV_EVAL_DIR=/app/data/evaluation
WORKDIR /app
COPY --from=build --chown=0:0 /out /app
COPY --chown=0:0 config/models /app/config/models
# Synthetic DEMO catalog; the seed loads it only when FV_DEMO_CATALOG=true.
COPY --chown=0:0 datasets/synthetic/catalog /app/data/catalog
# Golden RAG evaluation sets for AI Studio.
COPY --chown=0:0 datasets/evaluation /app/data/evaluation
# Files stay root-owned and read-only to the runtime user (uid 1000 = node).
USER 1000:1000
EXPOSE 3000
# api-http answers /api/live on $PORT; the worker answers /live on $FV_WORKER_HEALTH_PORT when set.
HEALTHCHECK --interval=15s --timeout=4s --start-period=40s --retries=3 \
  CMD ["node", "-e", "const w=process.env.FV_WORKER_HEALTH_PORT;fetch(w?`http://127.0.0.1:${w}/live`:`http://127.0.0.1:${process.env.PORT||3000}/api/live`).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/src/main.js"]
