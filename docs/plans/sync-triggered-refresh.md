# Sync-triggered data refresh

## What & Why
Replace the current mix of refresh triggers on the desktop Shop Floor board (tab-focus refetch, fixed 15-minute auto-refresh, manual Refresh button) with a single common trigger: the board refreshes only when D365 actually lands new data in the staging tables. Everyone then sees the same data at the same time, driven by the D365 export rather than per-user timers.

## Done looks like
- Opening the app still loads the most recent data immediately (scenario 1 unchanged).
- Switching to another browser tab and back no longer triggers a refetch (scenario 2 removed).
- The fixed 15-minute page auto-refresh is gone (scenario 3 removed).
- The manual Refresh button is removed from the header (scenario 4 removed).
- Instead, the app quietly checks a lightweight "latest sync timestamp" endpoint on a short interval; when the staging table's latest sync time changes, the full board data refetches automatically for all users at (nearly) the same moment.
- The "Last Data Sync" label keeps working and updates when a new sync is detected.
- Group edits still refetch immediately after a successful save (user's own action, not a background refresh).

## Out of scope
- Mobile shop floor app (keeps its 2-minute polling and pull-to-refresh unless requested separately).
- Push/WebSocket infrastructure — a cheap timestamp poll is sufficient and far simpler; the "common trigger" is the staging sync time, so all clients converge within one poll interval.
- Changing how or when D365 exports run.

## Steps
1. **Lightweight sync-check endpoint** — Add an API endpoint that returns only the latest staging sync timestamp (MAX of syncstartdatetime), fast and cheap enough to poll frequently.
2. **Client sync watcher** — On the desktop board, poll the sync-check endpoint on a short interval (e.g. every 60 seconds); when the timestamp advances past the last-seen value, invalidate/refetch the board queries. Keep initial load-on-mount behavior.
3. **Remove old triggers** — Disable refetch-on-window-focus for the board queries, remove the 15-minute refetchInterval, and remove the manual Refresh button from the header UI.
4. **Verify** — Confirm initial load works, tab switching causes no refetch, and simulating a newer sync timestamp triggers a full data refresh; run existing tests and update any that reference the Refresh button.

## Relevant files
- `artifacts/shop-floor/src/pages/dashboard.tsx:620-830`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1100-1140`
- `artifacts/api-server/src/routes/production.ts:320-400`
