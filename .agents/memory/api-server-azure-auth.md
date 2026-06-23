---
name: Azure auth in api-server
description: How Entra/Azure login is wired into the api-server and the web apps, and the route-gating model.
---

The api-server has Entra (Azure AD) login via MSAL authorization-code flow, mounted under `/api` (`/api/login`, `/api/auth/callback`, `/api/me`, `/api/logout`). Sessions are stored in Postgres (`DATABASE_URL` / `localPool`) via connect-pg-simple; `requireLogin` / `requireRole` middleware exist.

**Route gating:** In the api-server route index, only the auth router and the health router are public; a single `router.use(requireLogin)` sits before all business routers, so every other `/api` endpoint requires a session. Keep that ordering — add public routes above the gate, protected routes below it.

**Post-login return:** `/login` accepts a `returnTo` query, sanitized by `safeReturnTo()` (same-origin relative paths only — starts with `/`, not `//` — to block open redirects) and stored in the session; the callback redirects there. The web apps pass their current path so login returns the user to the app they came from.

**Frontend gate:** `@workspace/auth-react` (`lib/auth-react`) exports `AuthGate`, which calls `/api/me` and renders a "Sign in with Microsoft" screen when unauthenticated. It uses inline styles (no Tailwind) so it renders correctly across packages whose Tailwind config does not scan `lib/`. All three web apps wrap their router with it.

**Why:** The user explicitly asked to lock all data behind login and add login screens to all three apps.
**How to apply:** Azure app registration must have the `/api/auth/callback` redirect URI registered; authorized users must exist in `app.app_user` (is_active = true) or callback returns 403.
