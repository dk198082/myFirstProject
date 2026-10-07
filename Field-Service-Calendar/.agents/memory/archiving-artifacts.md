---
name: Archiving / removing an artifact
description: How to archive or remove a registered artifact in this monorepo (no dedicated archive callback exists).
---

# Archiving / removing an artifact

There is **no `archiveArtifact`/`deleteArtifact` callback**. To archive or remove an artifact:

1. **The platform discovers artifacts by scanning for `.replit-artifact/artifact.toml`
   repo-wide — NOT just under the `artifacts/*` pnpm glob.** Moving the dir to `archive/`
   is NOT enough: the toml there still gets re-registered (and will cause
   `DUPLICATE_PREVIEW_PATH` if it owns a path another artifact wants). To truly
   deregister, **rename/remove the artifact.toml** (e.g. `artifact.toml` →
   `artifact.toml.archived`). The platform then emits `Removed artifact: <Title>`.
   Moving the dir to top-level `archive/` is still nice for keeping it out of the pnpm
   workspace + in-tree for recovery, but the toml rename is the part that deregisters.
2. Run `pnpm install` afterward to drop the package from `pnpm-lock.yaml` — otherwise the
   frozen-lockfile install used at deploy time can break.
3. Run `pnpm run typecheck` to confirm nothing else referenced it.

**The artifact's workflow is artifact-managed.** `removeWorkflow({name})` fails with
`PROHIBITED_ACTION ... managed by an artifact and cannot be deleted via deleteRunWorkflow`,
both before and after the dir is moved. After the dir is gone the workflow simply goes to
`finished` (stopped) — that orphan entry is harmless; do not keep retrying removeWorkflow.

**Canvas frame:** the artifact's canvas iframe (`artifact:v3:artifacts/<slug>`) is removed
automatically when the artifact is deregistered — `getCanvasState` no longer lists it. You
cannot delete artifact frames manually (`applyCanvasActions` delete is constrained for
artifact frames anyway).

**Root-path caveat:** if the archived artifact owned `previewPath = "/"`, the root preview/
deploy URL becomes blank. Tell the user and offer to repoint another web artifact to `/`.
