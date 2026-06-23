---
name: Azure auth in api-server
description: How Entra/Azure login is wired into the api-server and why existing routes are not gated.
---

The api-server has Entra (Azure AD) login via MSAL authorization-code flow, mounted under `/api` (so `/api/login`, `/api/auth/callback`, `/api/me`, `/api/logout`). Sessions are stored in Postgres (`DATABASE_URL` / `localPool`) via connect-pg-simple; `requireLogin` / `requireRole` middleware exist.

**Decision:** Existing business routes (writeback, technicians, workOrders, dashboard, schedule board, etc.) are intentionally NOT yet wrapped with auth middleware.
**Why:** The three web frontends (field-service-schedule-board, dynamics-write-back, technician-dashboard) call `/api/*` with no login flow. Globally enforcing auth would 401 all of them. Gating routes is a product decision that requires adding login to the frontends first.
**How to apply:** Before adding `requireLogin`/`requireRole` to existing routers, confirm the calling frontend(s) actually perform login, or you will break them. Azure app registration must have the redirect URI registered and users seeded into `app.app_user`.
