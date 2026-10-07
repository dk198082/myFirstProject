---
name: Installing deps for a workspace-root file
description: How to add runtime deps used by a root-level (non-package) script in this pnpm monorepo.
---

The `installLanguagePackages` callback runs `pnpm add` at the workspace root, which fails with `ERR_PNPM_ADDING_TO_ROOT` (pnpm refuses root adds without `-w`).

**How to apply:** When a file lives at the repo root (e.g. a standalone `server.js`, root is CommonJS) and needs runtime deps, edit the root `package.json` `dependencies` directly, then run `pnpm install` (install, not add — no `-w` needed). Prefer giving code its own workspace package (under an existing `pnpm-workspace.yaml` glob) so the package tool works normally; only use the root approach when the user explicitly wants a root-level file.

**Why:** Saves re-discovering that the package-management tool can't target the workspace root.
