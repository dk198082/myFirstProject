# syntax=docker/dockerfile:1
#
# Builds ONE container that runs the Express API (artifacts/api-server) and
# also serves all four frontends — shop-floor, shop-floor-mobile,
# production-booking, new-booking-schedule — as static files under
# /apps/<name>/, so the whole app deploys as a single Azure App Service
# (Web App for Containers) or Azure Container Apps instance instead of five
# separate Azure resources.
#
# See AZURE_DEPLOYMENT.md for the required Azure resources and environment
# variables (DATABASE_URL, AZURE_PG_*, AZURE_TENANT_ID/AZURE_CLIENT_ID/
# AZURE_CLIENT_SECRET, D365_URL, STOREROOM_*, etc.) — none of those are baked
# into the image; they're supplied at deploy time as App Settings /
# Container Apps secrets.
#
# This is a single-stage build (not multi-stage). pnpm workspaces hoist
# dependencies via symlinks into a content-addressable store, which is fragile
# to split across build/runtime stages with a plain `COPY`. Building and
# running from the same image is a bit larger but reliable; shrink it later
# with a multi-stage `pnpm deploy` step if image size becomes a problem.

FROM node:24-bookworm-slim

WORKDIR /repo

RUN corepack enable

# Copy just the manifests first so `pnpm install` is cached across builds that
# only change application source.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/shop-floor/package.json artifacts/shop-floor/package.json
COPY artifacts/shop-floor-mobile/package.json artifacts/shop-floor-mobile/package.json
COPY artifacts/production-booking/package.json artifacts/production-booking/package.json
COPY artifacts/new-booking-schedule/package.json artifacts/new-booking-schedule/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile

# Now copy the rest of the source.
COPY . .

# vite.config.ts (every frontend artifact) requires PORT and BASE_PATH to even
# *load* the config, for both `dev` and `build`. PORT is a dummy value here —
# only read at build time, doesn't affect the runtime container. BASE_PATH is
# real: each frontend is mounted at /apps/<name>/ by the Express server (see
# the STATIC_ROOT_DIR block in artifacts/api-server/src/app.ts), so each must
# be built with base=/apps/<name>/ or its asset URLs would resolve to the
# site root instead and 404.
ENV PORT=4173

RUN BASE_PATH=/apps/shop-floor/            pnpm --filter @workspace/shop-floor run build \
 && BASE_PATH=/apps/shop-floor-mobile/     pnpm --filter @workspace/shop-floor-mobile run build \
 && BASE_PATH=/apps/production-booking/    pnpm --filter @workspace/production-booking run build \
 && BASE_PATH=/apps/new-booking-schedule/  pnpm --filter @workspace/new-booking-schedule run build

# Typecheck + build the API server (and re-typecheck everything — cheap after
# the frontend builds above already ran their own typecheck as part of `run build`).
RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

# Arrange the four builds under one directory, matching what STATIC_ROOT_DIR
# expects: <root>/<app-name>/index.html
RUN mkdir -p /repo/static-root \
 && cp -r artifacts/shop-floor/dist/public            /repo/static-root/shop-floor \
 && cp -r artifacts/shop-floor-mobile/dist/public      /repo/static-root/shop-floor-mobile \
 && cp -r artifacts/production-booking/dist/public     /repo/static-root/production-booking \
 && cp -r artifacts/new-booking-schedule/dist/public   /repo/static-root/new-booking-schedule

# --- Runtime ---------------------------------------------------------------
ENV NODE_ENV=production
# Azure App Service for Containers / Container Apps inject PORT themselves
# (App Service defaults to 8080 for custom containers); this is just the
# in-container default so `docker run -p 8080:8080` works out of the box.
ENV PORT=8080
ENV STATIC_ROOT_DIR=/repo/static-root

EXPOSE 8080

# Azure App Service / Container Apps health probes can point at GET /api/healthz.
WORKDIR /repo/artifacts/api-server
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
