---
title: New Booking Schedule standalone app
---
# New Booking Schedule Standalone App

## What & Why
The shop-floor app currently hosts two booking/scheduling pages ("/new-booking" and "/booking") accessible via nav tabs "New Booking / Schedule" and "Booking / Schedule". The user wants these extracted into their own standalone web app called "New Booking Schedule", and the tabs removed from shop-floor.

## Done looks like
- A new web artifact named "New Booking Schedule" exists and is accessible from the Replit preview dropdown
- The new app hosts both pages: the read-only machine-slot projection (previously `/new-booking`) and the interactive booking board (previously `/booking`), with full functionality intact (Excel export, slot management, milestone tracking, drag-to-reorder, etc.)
- The new app connects to the same shared API server for all `/api/booking-slots` and `/api/machine-orders` calls
- The "New Booking / Schedule" and "Booking / Schedule" nav buttons/tabs are removed from the shop-floor app's header
- The routes `/booking` and `/new-booking` are removed from shop-floor's `App.tsx`; navigating to those paths in shop-floor shows a not-found or redirects to the board

## Out of scope
- Changes to the API server routes or database
- Changes to the production-booking artifact (it is a separate, unrelated app)
- Moving shared UI components out of shop-floor (the new app should reference the shared lib or bundle its own copies as needed)

## Steps
1. **Scaffold the new artifact** — Create a new Vite + React web artifact in `artifacts/new-booking-schedule` using the pnpm-workspace and artifacts skill conventions; register it so it appears in the preview dropdown with slug/previewPath `/new-booking-schedule`. Set up wouter routing, TanStack Query, Sonner, and Tailwind identical to shop-floor.
2. **Copy and adapt the booking pages** — Copy `new-booking.tsx` and `booking-schedule.tsx` (and any sub-components they import: `AllocateDialog`, `SalesOrderPicker`, `business-days.ts`, related UI components) into the new artifact; fix all import paths.
3. **Wire up API client** — Configure the new app to call the shared API server using the same `@workspace/api-client-react` generated client (or replicate the base-URL pattern from shop-floor so all `/api/*` calls route correctly through the Replit proxy).
4. **Remove tabs from shop-floor** — Delete the "New Booking / Schedule" and "Booking / Schedule" nav buttons from `dashboard.tsx` header, remove the `/booking` and `/new-booking` routes from `App.tsx`, and remove the unused page imports.
5. **Verify** — Confirm the new app loads both pages, Excel export works on the projection page, slot mutations work on the booking board, and shop-floor no longer shows the removed tabs.

## Relevant files
- `artifacts/shop-floor/src/App.tsx`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1211-1240`
- `artifacts/shop-floor/src/pages/new-booking.tsx`
- `artifacts/shop-floor/src/pages/booking-schedule.tsx`
- `artifacts/shop-floor/src/components/AllocateDialog.tsx`
- `artifacts/shop-floor/src/components/SalesOrderPicker.tsx`
- `artifacts/shop-floor/src/lib/business-days.ts`
- `artifacts/shop-floor/vite.config.ts`
- `artifacts/shop-floor/package.json`
- `artifacts/production-booking/src/App.tsx`