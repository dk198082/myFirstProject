---
name: js-yaml v5 breaks orval codegen
description: orval's codegen script fails with "does not provide an export named 'default'" if js-yaml resolves to v5.
---

`orval` (used for `pnpm --filter @workspace/api-spec run codegen`) depends on `js-yaml` via a
CJS-style default import, which breaks under js-yaml v5 (pure ESM, no default export).

**Why:** the repo's `pnpm-workspace.yaml` `overrides` had `'js-yaml': '>=4.2.0'`, an open-ended
range that let pnpm resolve to the newer major version 5 and silently break codegen.

**How to apply:** keep the `js-yaml` override pinned to a `^4.x` range (e.g. `^4.2.0`), not an
unbounded `>=`. If codegen fails with a js-yaml ESM/default-export error, check this override
first before debugging orval or the OpenAPI spec itself.
