---
name: Entra login inside embedded/iframe previews
description: Why Microsoft sign-in fails in the Replit preview/canvas and how the frontends must handle it
---

# Entra (Microsoft) login can't run inside an iframe

Microsoft's login page (`login.microsoftonline.com`) sends `X-Frame-Options` /
`frame-ancestors` headers that forbid being displayed inside an iframe. The Replit
dev preview and canvas embed the app in an iframe, so any **in-frame** navigation to
the login URL renders as **"login.microsoftonline.com refused to connect"**.
Production is unaffected because the deployed app runs as its own top-level page.

**Why:** this is a Microsoft-side security header, not a bug in our auth config. When
you see "refused to connect", the auth config (client_id, redirect_uri, secret) is
almost certainly fine — the problem is purely that the flow was attempted in-frame.

**How to apply — frontend `login()` in both frontends (schedule-board + dynamics-write-back):**
- Not embedded (`window.top === window.self`, incl. prod/standalone tab): same-tab
  `window.location.href` — most reliable, cookies are first-party.
- Embedded: `window.open(url, "_blank", "noopener")` to run the flow top-level.
- Pop-up blocked (sandboxed canvas iframe without `allow-popups`): set a
  `popupBlocked` flag and **never** fall back to in-frame navigation (that is what
  produces "refused to connect"). `LoginGate` then shows an "Open this app in a new
  tab" link.

**Definitive dev fix (no code change):** open the app in its OWN browser tab
(`https://<dev-domain>/`) and sign in there, not the embedded preview.

Keep the two frontends' `useAuth.tsx` login logic identical.
