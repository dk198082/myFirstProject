import { Router, type IRouter } from "express";
import { eq, ne, and, asc, inArray, isNotNull } from "drizzle-orm";
import { db, bookingSlotsTable } from "@workspace/db";
import { getPool } from "../lib/azureDb";
import { logger } from "../lib/logger";
import { type Tab, isTab, buildTabCaseSql } from "../lib/classification";

const router: IRouter = Router();

const SCHEMA = "d365fo";
const DATA_AREA = "TOUS";

const ASSY_DEFAULTS: Record<Tab, number> = {
  "300SL": 15,
  "600SL": 20,
  "1000/2000SL": 25,
  MetalsImpact: 20,
  MFI: 20,
};
const DEFAULT_PICK = 5;
const DEFAULT_PACK = 10;
const DEFAULT_INTERVAL = 14;
const DEFAULT_COUNT = 26;

// SQL CASE that derives the model tab from the released product's sales
// classifications, generated from the same rules as classifyTab so the SQL and
// the JS classifier cannot drift apart.
const TAB_CASE = buildTabCaseSql("r.salesclassification2", "r.salesclassification3");

function str(val: unknown): string | undefined {
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

/** Most recent Monday on or before the given date (UTC, calendar-only). */
function recentMonday(from: Date): Date {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildCadence(
  tab: Tab,
  startDate: string | undefined,
  count: number,
  intervalDays: number,
): Array<typeof bookingSlotsTable.$inferInsert> {
  // Default start: a recent Monday two cycles before today, giving some past
  // context and a long runway of future slots.
  let start: Date;
  if (startDate) {
    start = new Date(`${startDate}T00:00:00Z`);
  } else {
    start = recentMonday(new Date());
    start.setUTCDate(start.getUTCDate() - 2 * intervalDays);
  }

  const rows: Array<typeof bookingSlotsTable.$inferInsert> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * intervalDays);
    rows.push({
      tab,
      slotIndex: i,
      productionStart: toIsoDate(d),
      pickDays: DEFAULT_PICK,
      assyDays: ASSY_DEFAULTS[tab],
      packDays: DEFAULT_PACK,
    });
  }
  return rows;
}

function serializeSlot(row: typeof bookingSlotsTable.$inferSelect) {
  return {
    id: row.id,
    tab: row.tab,
    slotIndex: row.slotIndex,
    productionStart: row.productionStart,
    pickDays: row.pickDays,
    assyDays: row.assyDays,
    packDays: row.packDays,
    prodOrder: row.prodOrder,
    salesOrder: row.salesOrder,
    itemid: row.itemid,
    itemname: row.itemname,
    customername: row.customername,
    productionstatus: row.productionstatus,
    deliverydate: row.deliverydate,
    pool: row.pool,
    productionGroup: row.productionGroup,
    resources: row.resources,
    confirmedShipDate: row.confirmedShipDate,
    inPacking: row.inPacking,
    progress: row.progress ?? {},
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

// GET /assignable-orders?search=&tab=
router.get("/assignable-orders", async (req, res): Promise<void> => {
  const search = str(req.query.search);
  const tab = str(req.query.tab);

  try {
    const pool = await getPool();
    const params: unknown[] = [DATA_AREA];

    let query = `
      SELECT
        p.productionordernumber                AS prodid,
        p.dataareaid,
        p.itemnumber                           AS itemid,
        p.productionordername                  AS itemname,
        p.productionorderstatus                AS productionstatus,
        CASE WHEN p.scheduledstartdate > '1990-01-01' THEN p.scheduledstartdate END AS schedulefromdate,
        CASE WHEN p.deliverydate       > '1990-01-01' THEN p.deliverydate       END AS deliverydate,
        p.scheduledquantity::float8            AS prodqty,
        p.demandsalesordernumber,
        p.productionpoolid                     AS pool,
        p.productiongroupid                    AS productiongroup,
        s.deliveryaddressname                  AS customername,
        CASE WHEN s.confirmedshippingdate > '1990-01-01' THEN s.confirmedshippingdate END AS confirmedshipdate,
        s.inpacking                            AS inpacking,
        rq.resources                           AS resources,
        ${TAB_CASE}                            AS tab
      FROM ${SCHEMA}.prodproductionorderheaderstaging p
      LEFT JOIN ${SCHEMA}.ecoresreleasedproductv2staging r
        ON r.itemnumber = p.itemnumber
       AND r.dataareaid = $1
      LEFT JOIN ${SCHEMA}.salesorderheaderv3staging s
        ON p.demandsalesordernumber = s.salesordernumber
       AND s.dataareaid = $1
      LEFT JOIN (
        SELECT
          productionordernumber,
          dataareaid,
          string_agg(
            DISTINCT requiredoperationsresourcegroupid,
            ', ' ORDER BY requiredoperationsresourcegroupid
          ) AS resources
        FROM ${SCHEMA}.prodproductionorderrouteoperationresourcerequirementstaging
        WHERE dataareaid = $1
          AND requiredoperationsresourcegroupid <> ''
        GROUP BY productionordernumber, dataareaid
      ) rq
        ON rq.productionordernumber = p.productionordernumber
       AND rq.dataareaid = p.dataareaid
      WHERE p.dataareaid = $1
        AND (${TAB_CASE}) IS NOT NULL
    `;

    if (tab) {
      params.push(tab);
      query += ` AND (${TAB_CASE}) = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      query += ` AND (
        p.productionordernumber ILIKE $${idx}
        OR p.itemnumber ILIKE $${idx}
        OR p.productionordername ILIKE $${idx}
        OR s.deliveryaddressname ILIKE $${idx}
      )`;
    }

    // A production order can only be booked once: exclude any order already
    // allocated to a booking slot. booking_slots lives in the local app DB, so
    // we read the allocated ids from there and filter them out of the D365 list.
    const allocatedRows = await db
      .select({ prodOrder: bookingSlotsTable.prodOrder })
      .from(bookingSlotsTable)
      .where(isNotNull(bookingSlotsTable.prodOrder));
    const allocatedIds = [
      ...new Set(
        allocatedRows
          .map((r) => r.prodOrder)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    ];
    if (allocatedIds.length > 0) {
      params.push(allocatedIds);
      query += ` AND p.productionordernumber <> ALL($${params.length}::text[])`;
    }

    query += " ORDER BY p.scheduledstartdate ASC NULLS LAST, p.productionordernumber ASC LIMIT 300";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "assignable-orders failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /machine-orders
// All machine production orders (across every model tab), NOT filtered by whether
// they're already booked. Drives the read-only New Booking / Schedule cadence
// projection, which needs the in-progress (Started, already-allocated) orders too.
router.get("/machine-orders", async (_req, res): Promise<void> => {
  try {
    const pool = await getPool();
    const params: unknown[] = [DATA_AREA];
    const query = `
      SELECT
        p.productionordernumber                AS prodid,
        p.dataareaid,
        p.itemnumber                           AS itemid,
        p.productionordername                  AS itemname,
        p.productionorderstatus                AS productionstatus,
        CASE WHEN p.scheduledstartdate > '1990-01-01' THEN p.scheduledstartdate END AS schedulefromdate,
        CASE WHEN p.deliverydate       > '1990-01-01' THEN p.deliverydate       END AS deliverydate,
        p.scheduledquantity::float8            AS prodqty,
        p.demandsalesordernumber,
        p.productionpoolid                     AS pool,
        p.productiongroupid                    AS productiongroup,
        s.deliveryaddressname                  AS customername,
        CASE WHEN s.confirmedshippingdate > '1990-01-01' THEN s.confirmedshippingdate END AS confirmedshipdate,
        s.inpacking                            AS inpacking,
        rq.resources                           AS resources,
        ${TAB_CASE}                            AS tab
      FROM ${SCHEMA}.prodproductionorderheaderstaging p
      LEFT JOIN ${SCHEMA}.ecoresreleasedproductv2staging r
        ON r.itemnumber = p.itemnumber
       AND r.dataareaid = $1
      LEFT JOIN ${SCHEMA}.salesorderheaderv3staging s
        ON p.demandsalesordernumber = s.salesordernumber
       AND s.dataareaid = $1
      LEFT JOIN (
        SELECT
          productionordernumber,
          dataareaid,
          string_agg(
            DISTINCT requiredoperationsresourcegroupid,
            ', ' ORDER BY requiredoperationsresourcegroupid
          ) AS resources
        FROM ${SCHEMA}.prodproductionorderrouteoperationresourcerequirementstaging
        WHERE dataareaid = $1
          AND requiredoperationsresourcegroupid <> ''
        GROUP BY productionordernumber, dataareaid
      ) rq
        ON rq.productionordernumber = p.productionordernumber
       AND rq.dataareaid = p.dataareaid
      WHERE p.dataareaid = $1
        AND (${TAB_CASE}) IS NOT NULL
      -- Most-recent first so the current pipeline (in-progress + committed
      -- future orders) is never dropped by the row cap in favour of the large
      -- backlog of old, completed orders.
      ORDER BY p.scheduledstartdate DESC NULLS LAST, p.productionordernumber DESC
      LIMIT 1000
    `;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "machine-orders failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /sales-orders?search=
router.get("/sales-orders", async (req, res): Promise<void> => {
  const search = str(req.query.search);

  try {
    const pool = await getPool();
    const params: unknown[] = [DATA_AREA];

    let query = `
      SELECT DISTINCT ON (s.salesordernumber)
        s.salesordernumber,
        s.deliveryaddressname             AS customername,
        s.orderingcustomeraccountnumber   AS customeraccount,
        CASE WHEN s.requestedshippingdate > '1990-01-01' THEN s.requestedshippingdate END AS requestedshippingdate,
        CASE WHEN s.confirmedshippingdate > '1990-01-01' THEN s.confirmedshippingdate END AS confirmedshipdate,
        s.inpacking                       AS inpacking
      FROM ${SCHEMA}.salesorderheaderv3staging s
      WHERE s.dataareaid = $1
    `;

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      query += ` AND (s.salesordernumber ILIKE $${idx} OR s.deliveryaddressname ILIKE $${idx})`;
    }

    query +=
      " ORDER BY s.salesordernumber DESC LIMIT 200";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "sales-orders failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /booking-slots?tab=
router.get("/booking-slots", async (req, res): Promise<void> => {
  const tab = req.query.tab;
  if (!isTab(tab)) {
    res.status(400).json({ error: "invalid_tab", message: "Unknown tab" });
    return;
  }

  try {
    let rows = await db
      .select()
      .from(bookingSlotsTable)
      .where(eq(bookingSlotsTable.tab, tab))
      .orderBy(asc(bookingSlotsTable.slotIndex), asc(bookingSlotsTable.id));

    if (rows.length === 0) {
      const seed = buildCadence(tab, undefined, DEFAULT_COUNT, DEFAULT_INTERVAL);
      await db.insert(bookingSlotsTable).values(seed);
      rows = await db
        .select()
        .from(bookingSlotsTable)
        .where(eq(bookingSlotsTable.tab, tab))
        .orderBy(asc(bookingSlotsTable.slotIndex), asc(bookingSlotsTable.id));
    }

    res.json(rows.map(serializeSlot));
  } catch (err: unknown) {
    logger.error({ err }, "booking-slots list failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /booking-slots
router.post("/booking-slots", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!isTab(body.tab)) {
    res.status(400).json({ error: "invalid_tab", message: "Unknown tab" });
    return;
  }
  const tab = body.tab as Tab;

  try {
    let slotIndex = body.slotIndex;
    if (typeof slotIndex !== "number") {
      const existing = await db
        .select({ slotIndex: bookingSlotsTable.slotIndex })
        .from(bookingSlotsTable)
        .where(eq(bookingSlotsTable.tab, tab))
        .orderBy(asc(bookingSlotsTable.slotIndex));
      slotIndex = existing.reduce((m, r) => Math.max(m, r.slotIndex), -1) + 1;
    }

    const [row] = await db
      .insert(bookingSlotsTable)
      .values({
        tab,
        slotIndex,
        productionStart:
          typeof body.productionStart === "string"
            ? body.productionStart
            : null,
        pickDays:
          typeof body.pickDays === "number" ? body.pickDays : DEFAULT_PICK,
        assyDays:
          typeof body.assyDays === "number"
            ? body.assyDays
            : ASSY_DEFAULTS[tab],
        packDays:
          typeof body.packDays === "number" ? body.packDays : DEFAULT_PACK,
      })
      .returning();

    res.status(201).json(serializeSlot(row));
  } catch (err: unknown) {
    logger.error({ err }, "booking-slots create failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /booking-slots/reset
router.post("/booking-slots/reset", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!isTab(body.tab)) {
    res.status(400).json({ error: "invalid_tab", message: "Unknown tab" });
    return;
  }
  const tab = body.tab as Tab;
  const startDate = str(body.startDate);
  const count = typeof body.count === "number" ? body.count : DEFAULT_COUNT;
  const intervalDays =
    typeof body.intervalDays === "number" ? body.intervalDays : DEFAULT_INTERVAL;

  try {
    await db.delete(bookingSlotsTable).where(eq(bookingSlotsTable.tab, tab));
    const seed = buildCadence(tab, startDate, count, intervalDays);
    await db.insert(bookingSlotsTable).values(seed);
    const rows = await db
      .select()
      .from(bookingSlotsTable)
      .where(eq(bookingSlotsTable.tab, tab))
      .orderBy(asc(bookingSlotsTable.slotIndex), asc(bookingSlotsTable.id));
    res.json(rows.map(serializeSlot));
  } catch (err: unknown) {
    logger.error({ err }, "booking-slots reset failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /booking-slots/swap
// Atomically swaps the order allocation (production + sales order snapshot)
// between two slots in a single transaction. Dates and durations stay fixed
// with each slot — only the booking moves. Used to move a booking up/down the
// calendar without any risk of a partial/half-applied swap.
router.post("/booking-slots/swap", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const sourceId = typeof body.sourceId === "number" ? body.sourceId : NaN;
  const targetId = typeof body.targetId === "number" ? body.targetId : NaN;
  if (Number.isNaN(sourceId) || Number.isNaN(targetId)) {
    res.status(400).json({
      error: "invalid_id",
      message: "sourceId and targetId are required numbers",
    });
    return;
  }
  if (sourceId === targetId) {
    res.status(400).json({
      error: "invalid_id",
      message: "sourceId and targetId must differ",
    });
    return;
  }

  const alloc = (r: typeof bookingSlotsTable.$inferSelect) => ({
    prodOrder: r.prodOrder,
    salesOrder: r.salesOrder,
    itemid: r.itemid,
    itemname: r.itemname,
    customername: r.customername,
    productionstatus: r.productionstatus,
    deliverydate: r.deliverydate,
    pool: r.pool,
    productionGroup: r.productionGroup,
    resources: r.resources,
    confirmedShipDate: r.confirmedShipDate,
    inPacking: r.inPacking,
    // Progress check-offs belong to the booking, so they move with it on swap.
    progress: r.progress ?? {},
  });

  try {
    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bookingSlotsTable)
        .where(inArray(bookingSlotsTable.id, [sourceId, targetId]));
      const a = rows.find((r) => r.id === sourceId);
      const b = rows.find((r) => r.id === targetId);
      if (!a || !b) return { ok: false, reason: "not_found" } as const;
      if (a.tab !== b.tab)
        return { ok: false, reason: "tab_mismatch" } as const;
      const [ua] = await tx
        .update(bookingSlotsTable)
        .set(alloc(b))
        .where(eq(bookingSlotsTable.id, sourceId))
        .returning();
      const [ub] = await tx
        .update(bookingSlotsTable)
        .set(alloc(a))
        .where(eq(bookingSlotsTable.id, targetId))
        .returning();
      return { ok: true, rows: [ua, ub] } as const;
    });

    if (!result.ok) {
      if (result.reason === "tab_mismatch") {
        res.status(400).json({
          error: "tab_mismatch",
          message: "Both slots must belong to the same tab",
        });
        return;
      }
      res
        .status(404)
        .json({ error: "not_found", message: "One or both slots not found" });
      return;
    }

    res.json(result.rows.map(serializeSlot));
  } catch (err: unknown) {
    logger.error({ err }, "booking-slots swap failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// PATCH /booking-slots/:id
router.patch("/booking-slots/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "invalid_id", message: "Invalid slot id" });
    return;
  }

  const body = req.body ?? {};
  const updates: Partial<typeof bookingSlotsTable.$inferInsert> = {};

  const stringNullable = [
    "productionStart",
    "prodOrder",
    "salesOrder",
    "itemid",
    "itemname",
    "customername",
    "deliverydate",
    "pool",
    "productionGroup",
    "resources",
    "confirmedShipDate",
  ] as const;
  for (const key of stringNullable) {
    if (key in body) {
      const v = body[key];
      updates[key] = v === null ? null : typeof v === "string" ? v : undefined;
    }
  }

  const intFields = ["slotIndex", "pickDays", "assyDays", "packDays"] as const;
  const durationFields: ReadonlySet<string> = new Set([
    "pickDays",
    "assyDays",
    "packDays",
  ]);
  for (const key of intFields) {
    if (key in body && typeof body[key] === "number") {
      const v = body[key] as number;
      if (durationFields.has(key) && (!Number.isFinite(v) || v < 0)) {
        res.status(400).json({
          error: "invalid_duration",
          message: `${key} must be a non-negative number`,
        });
        return;
      }
      updates[key] = v;
    }
  }

  if ("productionstatus" in body) {
    updates.productionstatus =
      body.productionstatus === null
        ? null
        : typeof body.productionstatus === "number"
          ? body.productionstatus
          : undefined;
  }

  if ("inPacking" in body) {
    updates.inPacking =
      body.inPacking === null
        ? null
        : typeof body.inPacking === "number"
          ? body.inPacking
          : undefined;
  }

  if ("progress" in body) {
    const p = body.progress;
    if (p !== null && typeof p === "object" && !Array.isArray(p)) {
      const allowed = [
        "pickStart",
        "pickEnd",
        "assyStart",
        "assyEnd",
        "packStart",
        "packEnd",
      ] as const;
      const clean: Record<string, boolean> = {};
      for (const key of allowed) {
        if ((p as Record<string, unknown>)[key] === true) clean[key] = true;
      }
      updates.progress = clean;
    }
  }

  // Drop any keys that resolved to undefined so they aren't written.
  for (const k of Object.keys(updates) as Array<keyof typeof updates>) {
    if (updates[k] === undefined) delete updates[k];
  }

  // Clearing an allocation: when prodOrder is explicitly nulled, also clear all
  // allocation snapshot fields so the slot can never retain stale metadata —
  // unless the caller explicitly set one of them in the same request.
  if ("prodOrder" in body && body.prodOrder === null) {
    const snapshot = [
      "salesOrder",
      "itemid",
      "itemname",
      "customername",
      "deliverydate",
      "productionstatus",
      "pool",
      "productionGroup",
      "resources",
      "confirmedShipDate",
      "inPacking",
    ] as const;
    for (const key of snapshot) {
      if (!(key in body)) {
        updates[key] = null;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    res
      .status(400)
      .json({ error: "no_fields", message: "No valid fields to update" });
    return;
  }

  // Enforce one-booking-per-production-order: reject if this prodOrder is already
  // allocated to a different slot.
  if (typeof updates.prodOrder === "string" && updates.prodOrder.length > 0) {
    const clash = await db
      .select({ id: bookingSlotsTable.id })
      .from(bookingSlotsTable)
      .where(
        and(
          eq(bookingSlotsTable.prodOrder, updates.prodOrder),
          ne(bookingSlotsTable.id, id),
        ),
      )
      .limit(1);
    if (clash.length > 0) {
      res.status(409).json({
        error: "already_allocated",
        message: `Production order ${updates.prodOrder} is already booked in another slot`,
      });
      return;
    }
  }

  try {
    const [row] = await db
      .update(bookingSlotsTable)
      .set(updates)
      .where(eq(bookingSlotsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "not_found", message: "Slot not found" });
      return;
    }

    res.json(serializeSlot(row));
  } catch (err: unknown) {
    logger.error({ err }, "booking-slots update failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// DELETE /booking-slots/:id
router.delete("/booking-slots/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "invalid_id", message: "Invalid slot id" });
    return;
  }

  try {
    const [row] = await db
      .delete(bookingSlotsTable)
      .where(eq(bookingSlotsTable.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "not_found", message: "Slot not found" });
      return;
    }

    res.json({ success: true });
  } catch (err: unknown) {
    logger.error({ err }, "booking-slots delete failed");
    res.status(500).json({
      error: "database_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
