# Board card pick tooltip and indicator

## What & Why
On the Production Shop Floor Schedule Board, hovering an order card should show a rich tooltip with all the card's details (order number, item name, configuration, start/end dates, scheduled hours), followed by the list of BOM items still remaining for picking, with the production group name at the bottom. Each card also gets a pick-status dot: green when all items are picked, red when items are still remaining. This replaces the current plain-text browser tooltip, making pick status visible at a glance without opening D365.

## Done looks like
- Hovering any board card (in both the grouped sections and the Unallocated section) shows a styled tooltip listing: order details as shown on the card, the remaining-to-pick items (quantity, unit, item number, description), and the production group name at the bottom.
- Orders with nothing left to pick show "All items picked" in the tooltip instead of a list.
- Every card shows a small dot: green = all items picked, red = items remaining. No dot while picking data is still loading.
- Existing card behavior (drag, group-change control, progress bar) is unchanged.

## Out of scope
- Any change to the picking data source or the D365 read-only database.
- The Production Booking app's board (this is the shop-floor Schedule Board only).
- Mobile app changes.

## Steps
1. **Rich tooltip component** — Replace the native `title` attribute pick tooltip on board cards with a styled hover tooltip (shadcn Tooltip already in the project) rendering card details, the remaining-pick item list, and the production group display name (from the existing production-groups lookup) at the bottom.
2. **Pick-status dot** — Add a green/red dot to each card derived from the already-fetched picking data: red when the order has items in the pick-remaining map, green otherwise; render nothing until the picking query has loaded.
3. **Apply to both card renderings** — The board renders cards in two places (group sections and Unallocated); apply the tooltip and dot to both.

Note: `/production-picking` only returns orders that still have remaining lines, so "not present in the response" means fully picked — the green dot must key off the query having loaded, not off a missing entry alone.

## Relevant files
- `artifacts/shop-floor/src/pages/dashboard.tsx:681-688,1255-1310,1650-1700`
- `artifacts/shop-floor/src/components/ui/tooltip.tsx`
- `artifacts/api-server/src/routes/production.ts:671-744`
