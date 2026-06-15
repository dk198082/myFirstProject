---
name: Auth & monorepo gotchas
description: Non-obvious pitfalls hit while adding Entra ID OIDC auth across the pnpm monorepo (drizzle push prompts, non-composite lib linkage, API-layer auth enforcement).
---

# Drizzle push prompts block on additive schema changes
`drizzle-kit push` (and `push-force`) can hang/fail on an interactive TTY rename-resolver
prompt when a new table's columns look like a rename of an unrelated existing table.
**How to apply:** For purely additive schema changes in this repo, run idempotent
`CREATE TABLE IF NOT EXISTS ...` via `psql "$DATABASE_URL"` instead of fighting the prompt.

# Non-composite libs consumed as source need a full root `pnpm install`
`lib/auth-web` is intentionally non-composite and consumed as source via package `exports`
(NOT a tsconfig project reference, NOT in root tsconfig references). A filtered
`pnpm --filter <app> add @workspace/auth-web` links it into the *app* but leaves
`lib/auth-web/node_modules` EMPTY, so its own deps (`react`, `@workspace/api-client-react`)
don't resolve and the app's typecheck fails with TS2307 on those imports.
**Why:** filtered add doesn't install the newly-added workspace package's own dependencies.
**How to apply:** after adding a new source-consumed lib, run a plain root `pnpm install`.

# UI auth gate is not API protection
An `AuthGate` React wrapper only hides the UI; API data routes stay open unless the
server enforces it. **How to apply:** mount a `requireAuth` guard in the server router
AFTER the public auth+health routers and BEFORE all data routers, returning 401 when
`!req.isAuthenticated()`.

# Entra ID OIDC adaptation of the Replit Auth template
Issuer = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`; confidential client via
`client.discovery(issuer, CLIENT_ID, CLIENT_SECRET)`; scopes `openid email profile offline_access`.
redirect_uri is derived from forwarded host headers (works on Replit proxy for dev+prod),
so each domain's `https://<domain>/api/callback` and post-logout `https://<domain>/` must be
registered in the Azure app registration. A single `/api/callback` serves both web apps via
the `return_to` cookie.
