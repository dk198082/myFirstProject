---
name: Schedule board parity (FS vs d365crm)
description: How the two schedule-board endpoints map regions→techs→bookings and a shared spec/handler quirk
---

# Schedule board parity (FS vs d365crm)

There are two schedule-board endpoints that must stay design/shape-identical:
- `GET /schedule-board` (FS Azure DB) in `scheduleBoard.ts`
- `GET /wb/schedule-board` (d365crm crm.* tables) in `writeback.ts`

## Region→technician mapping
- FS groups by `technicians.regionid_id` (a direct single-region field on the tech).
- CRM analog is `crm.msdyn_resourceterritory` (resource→territory), DISTINCT ON resource.
- **There is NO fallback to work-order service territory in either endpoint.** A booking only appears on the board if its technician/resource has a region/territory mapping. Do not "add" a work-order-territory fallback — it is not part of the reference design and would break parity.

## start-param convention
**Both** endpoints mark `start` as `required: false` in `openapi.yaml` but the handlers return 400 when it is missing. This mismatch is intentional/established — the frontends always pass `start`. Don't "fix" the wb endpoint's spec to diverge from the FS one; keep them consistent.

**Why:** A code review flagged these as bugs, but they match the existing FS endpoint's own convention; changing only the CRM side would create inconsistency, and adding a territory fallback would surface bookings the reference design intentionally omits.
