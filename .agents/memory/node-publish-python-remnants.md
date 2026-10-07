---
name: Publishing a Node workspace with Python remnants
description: Why a TypeScript workspace can unexpectedly enter Python package installation during publish
---

An unused root Python project manifest can make Replit's publishing installer run `uv lock` before any Node artifact build. A historical `.pythonlibs` containing packages but no Python executable then fails validation as a virtual environment, even if no app uses Python. Removing the unused manifest is preferable to deleting that directory when it may contain user-installed tooling.

**Why:** A publishing attempt stopped at Python dependency installation before the web or API build ran. The Python manifest declared no dependencies and only a template hello-world Python script existed.

**How to apply:** If publishing fails in `uv lock` on this primarily Node workspace, check whether a real Python project exists before changing Python tooling. The web artifact's build requires the service-defined `PORT` and `BASE_PATH`; a direct shell build without them fails even though the artifact-configured build can succeed. Test with the artifact's declared service environment rather than treating that shell-only error as a publish failure.