# syntax=docker/dockerfile:1.7
# Builds the Vite SPA and serves it with Caddy, which also reverse-proxies /api to the API.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/design-tokens packages/design-tokens
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @folioverse/web...
COPY packages/shared-config packages/shared-config
COPY apps/web apps/web
RUN pnpm --filter @folioverse/web run build

FROM caddy:2.8-alpine
COPY infrastructure/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
