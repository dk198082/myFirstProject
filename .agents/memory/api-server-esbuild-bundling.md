---
name: api-server esbuild bundling gotchas
description: What breaks when adding deps to the api-server, which esbuild bundles into a single ESM file.
---

The api-server is bundled by esbuild (`build.mjs`) into one `dist/index.mjs`. Two consequences when adding dependencies:

- Packages that read sibling files at runtime via their own module path break when bundled, because `__dirname` becomes `dist`. Example: `connect-pg-simple` with `createTableIfMissing: true` reads its packaged `table.sql`. Fix: provision the `session` table out of band (plain SQL) and set `createTableIfMissing: false`. (Alternatively add the package to the `external` list in `build.mjs`.)
- `build.mjs` externalizes `@azure/*` (and many native/ORM packages). Anything externalized must be a real runtime `dependency` of `@workspace/api-server` (not just devDependency), because production runs `node dist/index.mjs` from the workspace root and resolves it from node_modules.

**Why:** Saves re-debugging opaque runtime ENOENT / module-not-found errors that pass typecheck and local bundling but fail at runtime.

**How to apply:** Before adding a dep to api-server, check whether it (a) reads its own packaged files at runtime or (b) is in the `external` list of `build.mjs`.
