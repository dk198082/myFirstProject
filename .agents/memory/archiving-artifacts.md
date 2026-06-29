---
name: Archiving / removing an artifact
description: How to archive or remove a registered artifact in this monorepo (no dedicated archive callback exists).
---

# Archiving / removing an artifact

There is **no `archiveArtifact`/`deleteArtifact` callback**. To archive or remove an artifact:

1. Move (or delete) its directory out of `artifacts/<slug>/`. The workspace glob is
   `artifacts/*`, so moving the dir to a non-glob location (e.g. top-level `archive/`)
   deregisters it. The platform auto-detects this and emits `Removed artifact: <Title>`.
   Recoverable via git checkpoint either way; moving to `archive/` keeps it in-tree.
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
