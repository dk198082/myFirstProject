// Pure Schedule Board grouping / sorting logic, extracted from dashboard.tsx
// so it can be unit-tested. Keep this module free of React/hooks.
import type { BoardOrder } from "@workspace/api-client-react";
import { startOfDay, parseISO, format } from "date-fns";

// Schedule Board production-group display order. Groups are rendered in this
// order; any group not listed falls after these, sorted alphabetically.
// Assy08 (retired) is intentionally omitted: no filter pill, no board section.
export const GROUP_ORDER = [
  "Assy01", "Assy02", "Assy03", "Assy04", "Assy05", "Assy06", "Assy07",
  "Assy09", "Assy10", "Inst01", "Inst02", "Inst03",
  "Elec01", "Elec02", "Elec03", "Paint",
  "GenAssy", "GenInstr", "GenElec", "Elec Setup",
] as const;
// Only these production groups are shown on the Schedule Board; any order in
// another group is hidden from the board.
export const ALLOWED_GROUPS = new Set<string>(GROUP_ORDER);
// Production groups shown as filterable pills on the Schedule Board — always
// rendered, whether or not they currently hold orders. GenAssy/GenInstr/
// GenElec/"Elec Setup" are intentionally excluded: their orders roll up into
// the "Unallocated" section.
export const FILTER_GROUPS = [
  "Assy01", "Assy02", "Assy03", "Assy04", "Assy05", "Assy06", "Assy07",
  "Assy09", "Assy10", "Inst01", "Inst02", "Inst03",
  "Elec01", "Elec02", "Elec03", "Paint",
] as const;

/** Quick-select family buttons that toggle groups in bulk. */
export const FAMILY_FILTERS = [
  { label: "Assembly", members: new Set<string>(["Assy01","Assy02","Assy03","Assy04","Assy05","Assy06","Assy07","Assy09","Assy10"]) },
  { label: "Instrument", members: new Set<string>(["Inst01","Inst02","Inst03"]) },
  { label: "Electrical", members: new Set<string>(["Elec01","Elec02","Elec03"]) },
  { label: "Paint", members: new Set<string>(["Paint"]) },
] as const;
export type FamilyFilter = (typeof FAMILY_FILTERS)[number];
// Groups merged together into the always-shown "Unallocated" section.
export const UNALLOCATED_GROUPS = ["GenAssy", "GenInstr", "GenElec", "Elec Setup"] as const;
export const UNALLOCATED_SET = new Set<string>(UNALLOCATED_GROUPS);
// Synthetic resource-row key for Started orders that have no work-center
// reservation. They have no resource of their own, so they surface in an
// "Unassigned" row inside their own group section instead of being hidden.
export const UNASSIGNED_KEY = "__unassigned__";

export type CardSortOrder = "prodid" | "time-desc" | "time-asc";

export function toDateStr(d: string | null | undefined) {
  if (!d) return "";
  return d.substring(0, 10);
}

// Long-form date for detail pages ("Jul 17, 2026"). Truncates to the date part
// and parses as a LOCAL date: D365 exports dates as UTC-midnight timestamps, so
// new Date() would shift them one day back in timezones behind UTC.
export function fmtLongDate(d: string | null | undefined) {
  if (!d) return "N/A";
  try { return format(parseISO(d.substring(0, 10)), "MMM d, yyyy"); } catch { return d; }
}

// Sort the cards inside a single day cell. Ties (and the default sort) fall
// back to production order ID so the order is always deterministic.
export function sortDayOrders(orders: BoardOrder[], cardSort: CardSortOrder): BoardOrder[] {
  const byProdId = (a: BoardOrder, b: BoardOrder) =>
    String(a.prodid ?? "").localeCompare(String(b.prodid ?? ""));

  if (cardSort === "time-desc") {
    return [...orders].sort((a, b) => {
      const diff = (b.totalscheduledtime ?? 0) - (a.totalscheduledtime ?? 0);
      return diff !== 0 ? diff : byProdId(a, b);
    });
  }
  if (cardSort === "time-asc") {
    return [...orders].sort((a, b) => {
      const diff = (a.totalscheduledtime ?? 0) - (b.totalscheduledtime ?? 0);
      return diff !== 0 ? diff : byProdId(a, b);
    });
  }
  // Default: deterministic order by production order ID
  return [...orders].sort(byProdId);
}

export type BoardData = {
  /** productiongroupid → orders[] sorted by scheduledenddate ascending */
  groupedOrders: Record<string, BoardOrder[]>;
  unscheduledOrders: BoardOrder[];
  resourceColorMap: Record<string, number>;
  unallocatedOrders: BoardOrder[];
};

// Apply search/status filters then group orders for the board:
// productiongroupid → BoardOrder[] sorted by scheduledenddate ascending.
// Orders without a resource code (Started orders with no work-center
// reservation) are included in the flat list with resourcecode null/undefined.
// GenAssy/GenInstr orders (scheduled AND unscheduled) are pulled out into the
// flat, deduped "Unallocated" list instead.
export function buildBoardData(
  boardOrders: BoardOrder[] | undefined,
  q: string,
  activeStatuses: number[],
  paletteSize: number,
): BoardData {
  if (!boardOrders) {
    return {
      groupedOrders: {},
      unscheduledOrders: [],
      resourceColorMap: {},
      unallocatedOrders: [],
    };
  }

  // --- client-side filtering ---
  const searchLower = q.trim().toLowerCase();
  const safeBoardOrders = Array.isArray(boardOrders)
        ? boardOrders: [];
  const filtered = safeBoardOrders.filter((o) => {
    if (activeStatuses.length > 0 && !activeStatuses.includes(o.productionstatus as number)) return false;
    if (searchLower) {
      const id   = (o.prodid   as string ?? "").toLowerCase();
      const name = (o.itemname as string ?? "").toLowerCase();
      if (!id.includes(searchLower) && !name.includes(searchLower)) return false;
    }
    return true;
  });

  const allowed = filtered.filter(o => ALLOWED_GROUPS.has(o.productiongroupid as string));

  // Warn once per unrecognised group per call so developers notice if D365
  // introduces a new group before ALLOWED_GROUPS is updated. Suppressed in
  // test environments to keep test output clean.
  if (import.meta.env.MODE !== "test") {
    const unknownGroups = new Set(
      filtered
        .filter(o => !ALLOWED_GROUPS.has(o.productiongroupid as string))
        .map(o => o.productiongroupid as string)
    );
    unknownGroups.forEach(g => {
      console.warn(
        `[buildBoardData] Unknown production group "${g}" — orders in this group are hidden from the board. ` +
        `If this group is valid, add it to ALLOWED_GROUPS in board-logic.ts.`
      );
    });
  }
  // Separate unallocated-section orders before splitting scheduled/unscheduled,
  // so that GenAssy/GenInstr/GenElec/"Elec Setup" orders never appear in the
  // grouped board sections even when they happen to have a resource code.
  const sectionOrders    = allowed.filter(o => !UNALLOCATED_SET.has(o.productiongroupid as string));
  const unscheduledOrders = sectionOrders.filter(o => !o.resourcecode);
  const scheduledOrders   = sectionOrders.filter(o => !!o.resourcecode);

  // Stable color assignment: sorted unique resource codes → palette index
  const allResources = [...new Set(scheduledOrders.map(o => o.resourcecode!))].sort();
  const resourceColorMap: Record<string, number> = {};
  allResources.forEach((r, i) => { resourceColorMap[r] = i % paletteSize; });

  // Group: productiongroupid → flat BoardOrder[] (scheduled + unassigned)
  const groupedOrders: Record<string, BoardOrder[]> = {};
  scheduledOrders.forEach(order => {
    const g = order.productiongroupid as string;
    if (!groupedOrders[g]) groupedOrders[g] = [];
    groupedOrders[g].push(order);
  });

  // Started orders with NO work-center reservation are included in the flat
  // group list so planners still see in-progress work.
  // Unallocated-section groups are already excluded above.
  unscheduledOrders
    .filter(o => !UNALLOCATED_SET.has(o.productiongroupid as string))
    .forEach(order => {
      const g = order.productiongroupid as string;
      if (!groupedOrders[g]) groupedOrders[g] = [];
      groupedOrders[g].push(order);
    });

  // Deduplicate each group by prodid, then sort by scheduledenddate ascending.
  // Scheduled rows (with a resourcecode) are inserted before unscheduled rows
  // above, so the first occurrence of a prodid is always preferred — the
  // resource-assigned version wins over any bare route-operation duplicate.
  for (const g of Object.keys(groupedOrders)) {
    const seen = new Set<string>();
    groupedOrders[g] = groupedOrders[g].filter(o => {
      const id = o.prodid as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    groupedOrders[g].sort((a, b) => {
      const da = toDateStr(a.scheduledenddate) || "9999-99-99";
      const db = toDateStr(b.scheduledenddate) || "9999-99-99";
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  // All GenAssy + GenInstr orders (scheduled AND unscheduled), deduped by
  // prodid, for the always-visible "Unallocated" section. This list is NOT
  // restricted to the visible week/2-week window — the section shows every
  // such order regardless of its scheduled dates.
  const seenUnalloc = new Set<string>();
  const unallocatedOrders = allowed
    .filter((o) => UNALLOCATED_SET.has(o.productiongroupid as string))
    .filter((o) => {
      const id = o.prodid as string;
      if (seenUnalloc.has(id)) return false;
      seenUnalloc.add(id);
      return true;
    })
    .sort((a, b) => {
      const da = toDateStr(a.schedulefromdate) || "9999-99-99";
      const db = toDateStr(b.schedulefromdate) || "9999-99-99";
      return da < db ? -1 : da > db ? 1 : 0;
    });

  return { groupedOrders, unscheduledOrders, resourceColorMap, unallocatedOrders };
}

// An order appears in every weekday cell its [start, end] window overlaps.
// Orders entirely outside the visible [weekStart, weekEnd] window are dropped.
export function getOrdersForDay(
  orders: BoardOrder[],
  day: Date,
  weekStart: Date,
  weekEnd: Date,
): BoardOrder[] {
  const wStart = startOfDay(weekStart);
  const wEnd   = startOfDay(weekEnd);
  const dayD   = startOfDay(day);
  return orders.filter(order => {
    const sStr = toDateStr(order.schedulefromdate);
    const eStr = toDateStr(order.scheduledenddate);
    if (!sStr) return false;
    const start = startOfDay(parseISO(sStr));
    const end   = eStr ? startOfDay(parseISO(eStr)) : start;
    if (end < wStart || start > wEnd) return false;
    // Overlap: the order occupies every weekday between its start and end date.
    return dayD >= start && dayD <= end;
  });
}
