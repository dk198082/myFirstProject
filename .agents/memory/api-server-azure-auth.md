---
name: Azure auth in api-server
description: How Entra/Azure login is wired into the api-server and why existing routes are not gated.
---

The api-server has Entra (Azure AD) login via MSAL authorization-code flow, mounted under `/api` (so `/api/login`, `/api/auth/callback`, `/api/me`, `/api/logout`). Sessions are stored in Postgres (`DATABASE_URL` / `localPool`) via connect-pg-simple; `requireLogin` / `requireRole` middleware exist.

**Decision:** Existing business routes (writeback, technicians, workOrders, dashboard, schedule board, etc.) are intentionally NOT yet wrapped with auth middleware — this remains true even though dynamics-write-back now has a login gate.
**Why:** field-service-schedule-board AND dynamics-write-back both call the SAME shared `/api/wb/*` endpoints, but field-service-schedule-board has no login. Gating those shared routes server-side would 401 the schedule board. So per-app login must be enforced client-side, not by gating the shared routes.
**How to apply:** Before adding `requireLogin`/`requireRole` to existing routers, confirm EVERY frontend that calls that route performs login, or you will break the ones that don't. Azure app registration must have the redirect URI registered and users seeded into `app.app_user`.

**Current state:** dynamics-write-back has a client-side Entra login gate (AuthProvider/useAuth + LoginGate in its `src`) that calls `/api/me` and renders a "Sign in with Microsoft" screen when 401. It's a UX gate only, NOT a real authz boundary (shared wb routes stay open). If real authorization is needed later, protect only the mutating write-back routes and give the schedule board its own login too.

**returnTo:** `/api/login?returnTo=<relative path>` is supported — `sanitizeReturnTo` (in routes/auth.ts) only accepts same-origin paths (rejects `//`, `/\`, absolute/non-string) and callback redirects there instead of hardcoded `/`. Needed because path-based apps (e.g. `/dynamics-write-back/`) must land back in their own app after login.

**Redirect URI MUST include /api.** The Azure app registration redirect URI must be `https://<domain>/api/auth/callback` (WITH `/api`). The auth router is mounted at `app.use("/api", router)` and REDIRECT_URI (lib/auth.ts) is built from REPLIT_DOMAINS as `.../api/auth/callback`. A `/auth/callback` (no `/api`) URI can NEVER work: the shared proxy only routes `/api/*` to the api-server, so root `/auth/callback` hits a frontend and the token exchange never runs. Register BOTH the prod domain and the current dev `.replit.dev` domain (dev URL changes over time). AADSTS50011 echoes the *request's* redirect_uri, not the registered one — an error citing the old `/auth/callback` (matching the legacy standalone `attached_assets/server_*.js`, which used root `/auth/callback`) means a STALE cached authorize attempt in the browser, not current code. Fix: retry in a clean/incognito window.

**Login page can't be iframed.** login.microsoftonline.com sends X-Frame-Options/frame-ancestors, so signing in inside an embedded view (Replit preview/canvas iframe) shows "refused to connect". useAuth.login() detects `window.top !== window.self` and opens OAuth in a new top-level tab (falls back to top navigation). Logout hits the same limit (redirects to Entra logout) — best tested from the app opened directly in its own tab. In production (opened directly, not framed) both work normally.
