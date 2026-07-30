# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

WORKDIR /repo

RUN corepack enable

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Package manifests
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/new-booking-schedule/package.json artifacts/new-booking-schedule/package.json

# Shared libraries
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build Frontend
ENV PORT=4173

RUN BASE_PATH=/apps/new-booking-schedule/ \
    pnpm --filter @workspace/new-booking-schedule run build

# Build Libraries
RUN pnpm run typecheck:libs

# Build API
RUN pnpm --filter @workspace/api-server run build

# Arrange static files
RUN mkdir -p /repo/static-root \
 && cp -r artifacts/new-booking-schedule/dist/public \
    /repo/static-root/new-booking-schedule

# Runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT_DIR=/repo/static-root

EXPOSE 8080

WORKDIR /repo/artifacts/api-server

CMD ["node","--enable-source-maps","./dist/index.mjs"]