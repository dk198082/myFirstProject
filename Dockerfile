# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

WORKDIR /repo

RUN corepack enable \
 && corepack prepare pnpm@11.10.0 --activate

# --------------------------------------------------------------------
# Workspace manifests
# --------------------------------------------------------------------

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/field-service-schedule-board/package.json artifacts/field-service-schedule-board/package.json

COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/auth-react/package.json lib/auth-react/package.json
COPY lib/db/package.json lib/db/package.json

COPY scripts/package.json scripts/package.json

RUN pnpm install --no-frozen-lockfile

# --------------------------------------------------------------------
# Copy source
# --------------------------------------------------------------------

COPY . .

# --------------------------------------------------------------------
# Build-time variables
# --------------------------------------------------------------------

ENV PORT=4173
ENV BASE_PATH=/

# --------------------------------------------------------------------
# Build ONLY required libraries
# --------------------------------------------------------------------

RUN pnpm --filter @workspace/api-spec build
RUN pnpm --filter @workspace/api-zod build
RUN pnpm --filter @workspace/api-client-react build
RUN pnpm --filter @workspace/db build
RUN pnpm --filter @workspace/auth-react build

# --------------------------------------------------------------------
# Build frontend
# --------------------------------------------------------------------

RUN pnpm --filter @workspace/field-service-schedule-board build

# --------------------------------------------------------------------
# Build API
# --------------------------------------------------------------------

RUN pnpm --filter @workspace/api-server build

# --------------------------------------------------------------------
# Runtime
# --------------------------------------------------------------------

ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/repo/artifacts/field-service-schedule-board/dist/public

EXPOSE 8080

WORKDIR /repo/artifacts/api-server

CMD ["node","--enable-source-maps","dist/index.mjs"]