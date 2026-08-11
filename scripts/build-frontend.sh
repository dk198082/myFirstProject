#!/bin/bash
# Build all frontend artifacts with the correct environment variables for production.
#
# Each Vite config requires PORT, BASE_PATH, and NODE_ENV=production.
# These must match what the artifact.toml [services.env] and [services.production.build]
# sections provide at deploy time:
#
#   App                   PORT    BASE_PATH
#   shop-floor            22578   /
#   production-booking    25619   /production-booking/
#   new-booking-schedule  23641   /new-booking-schedule/
#
# Usage:
#   bash scripts/build-frontend.sh
#
# This script is also called by scripts/post-merge.sh so dist/ folders stay
# current after every task merge, preventing stale static files from reaching
# production.

set -e

echo "==> Building @workspace/shop-floor"
PORT=22578 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/shop-floor run build

echo "==> Building @workspace/production-booking"
PORT=25619 BASE_PATH=/production-booking/ NODE_ENV=production \
  pnpm --filter @workspace/production-booking run build

echo "==> Building @workspace/new-booking-schedule"
PORT=23641 BASE_PATH=/new-booking-schedule/ NODE_ENV=production \
  pnpm --filter @workspace/new-booking-schedule run build

echo "==> All frontend artifacts built successfully."
