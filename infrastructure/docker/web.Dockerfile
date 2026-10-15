# syntax=docker/dockerfile:1.7
# Builds the Vite SPA and the documentation site (/docs) and serves both with Caddy, which also
# reverse-proxies /api to the API.
# Non-root on :8080 with a read-only root filesystem (Caddy state lives under /tmp).
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
# Browser tracing is compiled in only when requested (spans go to the same-origin /otlp proxy).
ARG VITE_OTEL_ENABLED=false
ENV VITE_OTEL_ENABLED=$VITE_OTEL_ENABLED
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/design-tokens packages/design-tokens
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @folioverse/web... --filter @folioverse/docs...
COPY packages/shared-config packages/shared-config
# The in-app help and the docs site read the guides, status file, runbooks, OpenAPI documents and Prisma schema.
COPY docs docs
COPY infrastructure/runbooks infrastructure/runbooks
COPY packages/contracts/openapi packages/contracts/openapi
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/web apps/web
COPY apps/docs apps/docs
RUN pnpm --filter @folioverse/web run build && pnpm --filter @folioverse/docs run build

FROM caddy:2.11-alpine
# The stock binary carries cap_net_bind_service, which cannot be granted under no-new-privileges
# with all capabilities dropped; :8080 does not need it.
RUN apk upgrade --no-cache && apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
ENV XDG_CONFIG_HOME=/tmp/caddy/config XDG_DATA_HOME=/tmp/caddy/data
COPY infrastructure/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/docs/csp/docs-csp.caddy /etc/caddy/docs-csp.caddy
COPY --from=build /repo/apps/web/dist /srv
COPY --from=build /repo/apps/docs/dist /srv/docs
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
