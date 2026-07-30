---
name: Schedule Board working-week + allowed-groups + view span
description: Product decisions for the shop-floor Schedule Board (dashboard "/") grid and group rendering.
---

# Schedule Board (shop-floor dashboard, route "/")

- **Working week = Monday→Friday, 8h/day.** The grid shows weekday columns only
  (no weekend). Per-resource weekly capacity default = 40h (= 5 × 8h). A
  Week / 2-Week view toggle (`viewSpan` state) shows 5 or 10 weekday columns;
  in 2-week mode capacity comparison scales to perWeek × weeksToShow and
  prev/next nav steps by weeksToShow.
  **Why:** weekends are not working days; capacity is measured against the 40h
  working week, scaled to the visible span.
- **Allowed groups ONLY.** Orders still load only for the fixed set
  `GROUP_ORDER` = Assy01–Assy10 (MINUS Assy08), Inst01–Inst03, GenAssy, GenInstr
  (`ALLOWED_GROUPS = new Set(GROUP_ORDER)`); orders in any other group are hidden.
  **Why:** planners only schedule these groups; other D365 groups are noise.
  Assy08 is retired ("In Memory of Michael Nice") and was removed from both
  GROUP_ORDER and FILTER_GROUPS per user request — no pill, no section.
- **Board sections = 12 pill groups + one "Unallocated".** The board renders the
  schedulable groups `FILTER_GROUPS` = Assy01–Assy10 (minus Assy08), Inst01–Inst03 as
  individual sections (always shown, even empty → "open for scheduling"), plus a
  single always-shown **Unallocated** section for `UNALLOCATED_GROUPS`
  (GenAssy + GenInstr). GenAssy/GenInstr are no longer their own sections.
  **Why:** GenAssy/GenInstr are catch-alls, not real production groups.
- **Unallocated renders as red-bordered detail CARDS, NOT Gantt bars, and is
  NOT filtered by the week/2-week window.** Unlike every other section, the
  Unallocated section early-returns in `sections.map` (on `key ===
  "__unallocated__"`) to a card grid built from a flat `unallocatedOrders` list
  (`border-2 border-red-500`). `unallocatedOrders` = ALL GenAssy/GenInstr orders
  in `allowed` (scheduled AND unscheduled), deduped by prodid, sorted by
  schedulefromdate asc with undated last — note `toDateStr` returns `""` (not
  null) for no-date, so use `|| "9999-99-99"` NOT `?? ...` to push them last.
  Status + search filters still apply (via `allowed`); only the week window is
  skipped. Its `resources` map is intentionally `{}`. Each card shows prodid,
  itemname, group name + Pool, resource (or "Unassigned"), date range, hours,
  and % consumed. Pool comes from D365 productionpoolid.
  **How to apply:** do NOT route Unallocated through the Gantt render path or
  the per-week overlap filter; keep the early return. Other sections stay Gantt.
- **Group filtering = the pill bar ONLY (single source of truth).** The board's
  "FILTER PRODUCTION GROUPS" pill bar (All | None, local state
  `selectedGroups`/`groupsTouched`, `effectiveGroups`) decides which of the 13
  sections render; Unallocated always renders. The old URL/side-panel group
  filter (`activeGroups`) was REMOVED from the board (no dataset filtering, no
  panel checkboxes, no group chips). `activeGroups` is still threaded through the
  URL/preset plumbing but is always empty on the board.
  **Why:** two group filters (panel + pills) conflicted — pill "All" couldn't
  restore orders and Unallocated could render empty when the panel excluded
  GenAssy/GenInstr.
- **How to apply:** section set/order/visibility is driven by `FILTER_GROUPS` +
  `effectiveGroups` (pills) and `UNALLOCATED_GROUPS` — change those, not the
  per-order grouping. The dataset (`groupedOrders`) is filtered only by search +
  status, never by group.
- **Board rows render as continuous Gantt BARS, not per-day cards.** Each order is
  ONE horizontal bar stretching across the days it runs (a CSS-grid overlay over
  the day columns), showing its description/config/dates/hours/progress ONCE.
  Overlapping orders stack in lanes. The bar's day range is CLAMPED to the visible
  window, so the bar and its label stay visible even when the order started in an
  earlier week; `←`/`→` arrows mark carry-in / carry-out.
  **Why:** the user asked for a Gantt bar with the description always visible
  across week navigation — not the same card duplicated in every weekday cell.
  **How to apply:** do NOT revert to rendering a card per day cell; keep one bar
  spanning columns. The old per-cell helpers (getOrdersForDay/sortDayOrders) are
  now dead code.
- **Started orders stay on the board until completed (no lower date bound).** The
  `/production-board` endpoint applies ONLY the `toDate` upper bound; the `fromDate`
  lower bound was intentionally removed. Every board row is `STATUS_STARTED`, so
  in-progress orders whose whole schedule has already slipped into the PAST are
  still returned. The frontend Gantt uses a separate `ganttOrders` set (`start <=
  wEnd`, so past + current, not future) and PINS a fully-past order to the first
  visible column (`first=0,last=0,carriedIn=true`) with a `←` marker.
  **Why:** an overdue order that D365 still marks Started is physically in progress
  and must not vanish just because its dates are behind the visible window.
  **How to apply:** capacity/`totalTime` still uses the strict-overlap `weekOrders`
  set (NOT `ganttOrders`) so past work doesn't inflate the current week's load.
- **"Unassigned" row per group section for orders with no work-center.** An order's
  resource row comes from the capacity-reservation table; a Started order with NO
  reservation has `resourcecode = null` and would otherwise be hidden. Such orders
  (excluding GenAssy/GenInstr, which roll up to Unallocated) are placed in a
  synthetic `UNASSIGNED_KEY = "__unassigned__"` row inside their own group section,
  sorted LAST, labeled "Unassigned / No work-center assigned" with no capacity
  bar/override (it's not a real resource).
  **Why:** in-progress work with no assigned resource still needs to be visible
  under its group (e.g. Assy10 order 364222). Only ~1 order hit this in practice.
- **Time totals: coerce `totalscheduledtime` with `Number()`.** It arrives as a
  PG numeric STRING (api SUM()), so `sum + o.totalscheduledtime` concatenates and
  multi-order resources/sections produce "NaNh NaNm". Always `Number(x) || 0`.
- **Order cards** intentionally do NOT show sales account or production-status
  label; the progress bar shows bold "% consumed" (consumed ÷ scheduled hours).
- **Section headers show the group NAME, not the id.** Labels resolve the raw
  productiongroupid to `costproductiongroupstaging.groupname` via the
  `/production-groups` lookup (a separate endpoint so empty groups still get
  names); fall back to the id when unmapped. The pill bar still uses ids.
- **Card tooltip = remaining-to-pick components.** Native `title` on each order
  card lists BOM component `itemnumber — remaining unit`, read DIRECTLY from
  `remainingbomlinequantity` + `bomlineunitsymbol` (do NOT recompute from picking
  math). Data comes from the `/production-picking` endpoint, fetched SEPARATELY
  from the board (React Query) so the board never blocks. See
  [board pick-remaining](board-pick-remaining.md).
- **Resource Utilization section (bottom of board) = POSTED hours, group-level,
  40h/group capacity.** Sourced from `/production-utilization` (posted route-card
  journal, `isposted=1`, Warehouse Pick/Receive ops excluded), aggregated per
  productiongroupid. Capacity is FIXED at 8h × 5 × weeksToShow per group (the
  design decision "each board group ≈ one operator") — per-resource capacity
  overrides do NOT apply here. Posted hours include ALL orders posted under a
  group (not just Machine board orders), so utilization reflects the operator's
  real load; the zero-hours flag, however, is scoped to assigned BOARD orders
  (`groupedOrders`) that have no posted rows that week. **Why:** journal postings
  lag ~a week, so the current week often reads empty and everything flags — that
  is correct, navigate back a week to see real utilization.
