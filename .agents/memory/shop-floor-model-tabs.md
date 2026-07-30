---
name: Shop-floor model tabs
description: How production orders are sorted into the product-line tabs on the booking board (classification-based).
---

The production booking board groups production orders into product-line tabs using the **released product's Sales Classifications** (table `d365fo.ecoresreleasedproductv2staging`, joined on `itemnumber` + `dataareaid`). An order only appears on the board when its product's **Sales Classification 2** is in the tab's allowed class-2 set AND its **Sales Classification 3** matches the tab:

- `class2='Machine'` + `class3='300SL'` → **300SL**
- `class2='Machine'` + `class3='600SL'` → **600SL**
- `class2='Machine'` + `class3 IN ('1000SL','2000SL')` → **1000/2000SL**
- `class2='Machine'` + `class3 IN ('IT406','IT542')` → **MetalsImpact**
- `class2='Machine'` + `class3 IN ('MP1200','MP1200MAN','MP1200MWLD','MP1500')` → **MFI**
- anything else → unassigned (excluded from the board)

**Why:** the user requested classification-driven sorting (replacing the earlier item-number-prefix heuristic). MetalsImpact has no literal value, so it maps to `IT406`/`IT542`. The **MFI** tab requires `class2='Machine'` like every other tab — the user explicitly chose to keep class2 as Machine only, so the `class2='MFI'`-classified MP1500 machines (~17 in TOUS) are NOT included; only the Machine-class MP1200 family + the few Machine-class MP1500. The MP1200 family deliberately **excludes** the `MP1200ETO` variant (user decision). Non-matching orders resolve to NULL tab and are filtered out.

The classification rules live in one place: `artifacts/api-server/src/lib/classification.ts`. Each entry in `TAB_RULES` carries its own `class2` **and** `class3` arrays (all tabs currently use `class2=['Machine']`; the structure supports multiple class2 values per rule if ever needed). `classifyTab(class2, class3)` (pure JS, unit-tested) and `buildTabCaseSql(...)` (the SQL CASE used by `booking.ts`) are both generated from `TAB_RULES`, so the JS classifier and the SQL cannot drift. To add/rename a tab or class value, edit `TAB_RULES` only. Case-sensitive exact match. Tests: `classification.test.ts`, wired into the `test` validation via `pnpm -r --if-present run test`.

**How to apply:** if a tab "loses" orders, check the product's `salesclassification2`/`salesclassification3` first — a product mis-classified in D365 (or a `Machine`/`MFI` with an unmapped class3) will silently drop off the board. Frontend tab strips are separate hardcoded arrays that must be kept in step per app: `TABS` in `booking-schedule.tsx` and `ALL_TABS` in `AllocateDialog.tsx` (the `production-booking` app has its own copies — currently NOT updated with MFI, Shop Floor only). Released-product staging can contain duplicate `(dataareaid,itemnumber)` rows; if duplicates ever surface in the picker, dedupe the released-product join (DISTINCT ON / EXISTS subquery that still projects the tab).

Per-tab assembly-day defaults used when seeding the bi-weekly (14-day) cadence: 300SL=15, 600SL=20, 1000/2000SL=25, MetalsImpact=20, MFI=20; pick=5, ship=10 days for all. Default cadence horizon is 26 slots (~1 year of biweekly).

**Booking schedule math (forward sequence, working days, weekends skipped):** Production Start → Pick = WORKDAY(Prod Start, pickDays); Assy Start = Pick; Assy End = WORKDAY(Assy Start, assyDays); Ship Date = WORKDAY(Assy End, shipDays). The board surfaces all of Prod Start, Pick, Assy Start, Assy End, Ship Date (mirrors the spreadsheet columns).

**Allocation UX (planner-driven, decided with user):** a slot's Production Order and Sales Order are two **independent** side-by-side panels, each with its own Select/Change/Clear. Either may be set first or alone. Order picker defaults its filter to the slot's tab but allows any line (cross-tab override). Picking a production order auto-links its `demandsalesordernumber` **only when the slot has no sales order yet** — never overwrites a planner's manual SO choice.
**Why:** clearing one side must keep the other. The server PATCH clear-cascade nulls all snapshot fields when `prodOrder` is sent null *unless* a field is explicitly present in the body — so the clear-prod payload must re-send the current `salesOrder`/`customername` to preserve them; clear-SO omits `prodOrder` entirely so the cascade never fires.
