# Stop browsers from caching the old app version after a deploy

## What & Why
Some users see a stale version of the app after a redeploy and must use incognito mode (empty cache) to get the new one. Root cause: browsers cache `index.html`, which is the entry point that references the JS/CSS bundles. When a new deploy ships new bundles (with new content-hash filenames), users whose browsers served the old cached `index.html` still load the old bundles.

Fix: add `Cache-Control: no-cache` to HTML responses so browsers always revalidate the entry point before using it. The JS/CSS assets keep their long-term cache (they already have content hashes, so stale bundles are never served).

## Done looks like
- After a redeploy, all users see the new version on their next page load — without needing incognito or a manual cache clear
- JS/CSS bundle caching is unaffected (still long-lived)
- Fix applies to all deployed Vite SPA artifacts

## Out of scope
- CDN-level cache invalidation (Replit's hosting handles that)
- Service worker caching (none is registered in this project)

## Steps
1. **Identify how the deployed apps serve static files** — check the artifact.toml run commands and Replit deployment config to confirm whether the deployed app uses `vite preview`, a custom Express static server, or another mechanism.
2. **Add `Cache-Control: no-cache` to HTML responses** — for each Vite SPA artifact, configure the server (preview server headers in `vite.config.ts` or the Express layer if one exists) to send `Cache-Control: no-cache` only for `*.html` responses. Leave JS/CSS/font assets with their default long-lived cache.
3. **Verify** — confirm the header is present on the deployed `index.html` using a curl or browser DevTools Network tab after redeploying.

## Relevant files
- `artifacts/shop-floor/vite.config.ts`
- `artifacts/shop-floor-mobile/vite.config.ts`
- `artifacts/production-booking/vite.config.ts`
- `artifacts/new-booking-schedule/vite.config.ts`
- `artifacts/shop-floor/.replit-artifact/artifact.toml`
