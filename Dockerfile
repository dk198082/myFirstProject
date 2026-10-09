# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

WORKDIR /repo

# --------------------------------------------------------------------
# pnpm
# --------------------------------------------------------------------

RUN corepack enable \
 && corepack prepare pnpm@11.10.0 --activate

# --------------------------------------------------------------------
# Workspace manifests
# --------------------------------------------------------------------

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Applications
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/field-service-schedule-board/package.json artifacts/field-service-schedule-board/package.json
COPY artifacts/pro-forma-service-invoice/package.json artifacts/pro-forma-service-invoice/package.json

# Other workspace packages that are part of this repository
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json

# Workspace libraries
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/auth-react/package.json lib/auth-react/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/production-priority-design-system/package.json lib/production-priority-design-system/package.json

# Scripts
COPY scripts/package.json scripts/package.json

# --------------------------------------------------------------------
# Install dependencies
# --------------------------------------------------------------------

RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------------
# Copy complete source
# --------------------------------------------------------------------

COPY . .

# --------------------------------------------------------------------
# Typecheck
# --------------------------------------------------------------------

RUN pnpm run typecheck

# --------------------------------------------------------------------
# Build API and workspace packages
# --------------------------------------------------------------------

RUN pnpm \
  --filter "@workspace/api-server" \
  --filter "./lib/**" \
  --filter "./scripts" \
  --if-present \
  run build

# --------------------------------------------------------------------
# Build Field Service frontend
# Served from /
# --------------------------------------------------------------------

RUN PORT=4173 BASE_PATH=/ \
  pnpm --filter "@workspace/field-service-schedule-board" run build

# --------------------------------------------------------------------
# Build Pro Forma Service Invoice frontend
# Served from /pro-forma-service-invoice/
# --------------------------------------------------------------------

RUN PORT=19475 BASE_PATH=/pro-forma-service-invoice/ \
  pnpm --filter "@workspace/pro-forma-service-invoice" run build

# --------------------------------------------------------------------
# Runtime
# --------------------------------------------------------------------

ENV NODE_ENV=production

ENV PORT=8080

ENV STATIC_DIR=/repo/artifacts/field-service-schedule-board/dist/public

ENV STATIC_PRO_FORMA_DIR=/repo/artifacts/pro-forma-service-invoice/dist/public

EXPOSE 8080

WORKDIR /repo/artifacts/api-server

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]