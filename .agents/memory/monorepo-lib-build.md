---
name: Monorepo lib codegen/build
description: Build/codegen ordering gotchas when changing shared libs in this pnpm monorepo.
---

This is a pnpm + TypeScript project-references monorepo. Leaf apps (`artifacts/*`) depend on built `.d.ts` from shared libs (`lib/*`), so editing a lib source file is not enough — the lib's declarations must be rebuilt before a leaf typecheck sees the change.

**After editing `lib/db` schema (e.g. adding a Drizzle table):** run `pnpm -w run typecheck:libs` (which does `tsc --build`) so `@workspace/db` declarations rebuild and re-export the new table; only then will `artifacts/api-server` typecheck resolve the new export.

**After editing `lib/api-spec/openapi.yaml`:** run the codegen command (orval-style) to regenerate `lib/api-client-react` (react-query hooks + `api.schemas.ts`) and `lib/api-zod`. The spec file uses **OpenAPI 3.0 `nullable: true`** style (not 3.1 `type: [..., 'null']`) — match it. Each schema generates per-type files under `lib/api-zod/src/generated/types/`.

**Why:** skipping the lib rebuild produces confusing "property does not exist on type" errors in the leaf package even though the source clearly defines it.
