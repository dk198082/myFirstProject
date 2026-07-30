import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { db, productionGroupOverridesTable } from "@workspace/db";
import { getPool } from "../lib/azureDb";
import { logger } from "../lib/logger";
import { buildTabCaseSql } from "../lib/classification";
import { updateProductionGroupInD365, D365Error } from "../lib/d365Odata";
import { sendMailViaGraph, GraphMailError } from "../lib/graphMail";
import { expectedConsumedHours } from "../lib/expectedPace";

const router: IRouter = Router();

const SCHEMA = "d365fo";
const DATA_AREA = "TOUS";

// SQL CASE that resolves a production order's model tab from its released
// product's sales classifications. Used to keep only the four model tabs
// (300SL / 600SL / 1000/2000SL / MetalsImpact) on the shop-floor pages.
const TAB_CASE = buildTabCaseSql("rp.salesclassification2", "rp.salesclassification3");
// D365 production order status 4 = "Started"; the Schedule Board shows only these.
const STATUS_STARTED = 4;

// Performance KPI scope: production groups included in the KPI / delivery report.
const KPI_GROUPS = [
  "Assy01", "Assy02", "Assy03", "Assy04", "Assy05",
  "Assy06", "Assy07", "Assy08", "Assy09", "Assy10",
  "Inst01", "Inst02", "Inst03",
] as const;
const KPI_GROUPS_SQL = KPI_GROUPS.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");

// Schedule Board scope: only Machine orders (Sales Classification 2) whose Sales
// Classification 3 is one of these models. Broader than the booking model tabs.
const SCHEDULE_BOARD_CLASS3 = [
  "MP1200MAN", "MP1200MWLD", "MP1200ETO", "MP1500",
  "HDVT6", "HDVT3", "602 Disp", "NO-CNSL", "CNSL-NOHYD", "CNSL-HYD", "MMHT",
  "300SL", "600SL", "1000SL", "2000SL", "3000SL", "Torsion",
  "899", "799", "IT504", "IT503", "IT406", "IT542",
] as const;
const SCHEDULE_BOARD_CLASS3_SQL = SCHEDULE_BOARD_CLASS3
  .map((v) => `'${v.replace(/'/g, "''")}'`)
  .join(", ");

function str(val: unknown): string | undefined {
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

// ── GET /production-orders ──────────────────────────────────────────────────
// Tries stored function productionordersd365us() first; falls back to direct
// table query if the function is unavailable. Returns 500 only on total failure.
router.get("/production-orders", async (req, res): Promise<void> => {
  const fromDate = str(req.query.fromDate);
  const toDate = str(req.query.toDate);

  try {
    const pool = await getPool();

    // ── Attempt 1: stored function ──────────────────────────────────────────
    try {
      const procParams: unknown[] = [DATA_AREA];
      let procQuery = `
        SELECT
          productionordernumber         AS prodid,
          dataareaid,
          COALESCE(NULLIF(productiongroupid, ''), '(ungrouped)') AS productiongroupid,
          itemnumber                    AS itemid,
          productionordername           AS itemname,
          scheduledstartdate            AS schedulefromdate,
          NULL::timestamptz             AS scheduledenddate,
          scheduledquantity             AS prodqty,
          remainingreportasfinishedquantity AS remaininventphysical,
          productionorderstatus::integer AS productionstatus,
          status                        AS productionstatustext,
          demandsalesordernumber,
          dataareaid
        FROM ${SCHEMA}.productionordersd365us()
        WHERE dataareaid = $1
      `;
      if (fromDate) { procParams.push(fromDate); procQuery += ` AND scheduledstartdate >= $${procParams.length}`; }
      if (toDate)   { procParams.push(toDate);   procQuery += ` AND scheduledstartdate <= $${procParams.length}`; }
      procQuery += " ORDER BY scheduledstartdate ASC, productiongroupid ASC";

      const procResult = await pool.query(procQuery, procParams);
      res.json(procResult.rows);
      return;
    } catch (procErr: unknown) {
      logger.warn({ err: procErr }, "productionordersd365us() unavailable, falling back to table");
    }

    // ── Attempt 2: direct table query ────────────────────────────────────────
    const params: unknown[] = [DATA_AREA];
    let query = `
      SELECT
        productionordernumber         AS prodid,
        dataareaid,
        COALESCE(NULLIF(productiongroupid, ''), '(ungrouped)') AS productiongroupid,
        itemnumber                    AS itemid,
        productionordername           AS itemname,
        scheduledstartdate            AS schedulefromdate,
        scheduledenddate,
        scheduledquantity             AS prodqty,
        remainingreportasfinishedquantity AS remaininventphysical,
        productionorderstatus         AS productionstatus,
        demandsalesordernumber,
        productionsiteid              AS siteid,
        productionwarehouseid         AS warehouseid
      FROM ${SCHEMA}.prodproductionorderheaderstaging
      WHERE dataareaid = $1
    `;
    if (fromDate) { params.push(fromDate); query += ` AND scheduledstartdate >= $${params.length}`; }
    if (toDate)   { params.push(toDate);   query += ` AND scheduledenddate <= $${params.length}`; }
    query += " ORDER BY scheduledstartdate ASC, productiongroupid ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-orders failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-route-details ───────────────────────────────────────────
// Queries the staging tables directly (bypasses productionroutedetailsd365()
// which full-scans every order at 57s+). prodproductionorderrouteoperationstaging
// has 2 rows per (order, operationnumber) from two D365 export jobs — deduplicated
// with DISTINCT ON before JOINing routeoperationstaging for the name.
// Returns 500 on failure — does NOT silently return empty results.
router.get("/production-route-details", async (req, res): Promise<void> => {
  const prodid = str(req.query.prodid);

  try {
    const pool = await getPool();

    const procParams: unknown[] = [DATA_AREA];
    let prodidClause = "";
    if (prodid) { procParams.push(prodid); prodidClause = ` AND productionordernumber = $${procParams.length}`; }

    const procQuery = `
      SELECT
        ro.productionordernumber         AS prodid,
        ro.dataareaid,
        ro.operationnumber::text         AS operationnumber,
        rop.operationname::text          AS operationname,
        ro.costingoperationresourceid    AS workcenterid,
        ro.scheduledfromdate             AS schedulefromdate,
        ro.scheduledenddate,
        ro.estimatedsetuptime            AS setuptime,
        ro.estimatedprocesstime          AS processtime,
        ro.routeoperationremainderstatus AS status
      FROM (
        -- prodproductionorderrouteoperationstaging has 2 rows per
        -- (productionordernumber, operationnumber) from two D365 export jobs
        -- with different operationid values. Deduplicate to ONE row before
        -- joining so each operation appears exactly once.
        SELECT DISTINCT ON (productionordernumber, operationnumber)
          productionordernumber, dataareaid, operationnumber, operationid,
          costingoperationresourceid, scheduledfromdate, scheduledenddate,
          estimatedsetuptime, estimatedprocesstime, routeoperationremainderstatus,
          routeoperationsequence
        FROM ${SCHEMA}.prodproductionorderrouteoperationstaging
        WHERE dataareaid = $1${prodidClause}
        ORDER BY productionordernumber, operationnumber, routeoperationsequence ASC
      ) ro
      JOIN ${SCHEMA}.routeoperationstaging rop
        ON  rop.operationid = ro.operationid
        AND rop.dataareaid  = ro.dataareaid
      ORDER BY ro.productionordernumber ASC, ro.routeoperationsequence ASC
    `;

    const procResult = await pool.query(procQuery, procParams);
    res.json(procResult.rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-route-details failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-route-transactions ──────────────────────────────────────
// Per-order posted-hours transactions: each row = (operationnumber, workername,
// postingdate) with summed hours. Used by the order-detail "Hours Posted" table.
router.get("/production-route-transactions", async (req, res): Promise<void> => {
  const prodid = str(req.query.prodid);
  if (!prodid) {
    res.status(400).json({ error: "bad_request", message: "prodid query parameter is required" });
    return;
  }
  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT
         t.operationnumber::text                                     AS operationnumber,
         NULLIF(TRIM(rop.operationname), '')                         AS operationname,
         NULLIF(TRIM(h.name), '')                                    AS workername,
         to_char(t.estimatedaccountingdate, 'YYYY-MM-DD')            AS postingdate,
         SUM(t.registeredhours)::float8                              AS postedhours,
         COALESCE(NULLIF(TRIM(p.productiongroupid), ''), '—')        AS productiongroupid,
         NULLIF(TRIM(g.groupname), '')                               AS groupname
       FROM ${SCHEMA}.prodproductionroutetransactionstaging t
       LEFT JOIN ${SCHEMA}.hcmworkerstaging h
         ON  h.recid = t.toworker
       LEFT JOIN ${SCHEMA}.routeoperationstaging rop
         ON  rop.operationid = t.operationid
         AND rop.dataareaid  = t.dataareaid
       -- prodproductionorderheaderstaging has 3 rows per order (one per D365
       -- export job). Deduplicate to ONE row per order before joining to avoid
       -- a 3× fan-out that would triple every hours sum.
       LEFT JOIN (
         SELECT DISTINCT ON (productionordernumber, dataareaid)
           productionordernumber, dataareaid, productiongroupid
         FROM ${SCHEMA}.prodproductionorderheaderstaging
         ORDER BY productionordernumber, dataareaid
       ) p
         ON  p.productionordernumber = t.torefnumber::text
         AND p.dataareaid            = t.dataareaid
       LEFT JOIN ${SCHEMA}.costproductiongroupstaging g
         ON  g.groupid    = p.productiongroupid
         AND g.dataareaid = t.dataareaid
       WHERE t.dataareaid        = $1
         AND t.torefnumber::text = $2
         AND t.registeredhours   > 0
       GROUP BY t.operationnumber, rop.operationname, h.name,
                t.estimatedaccountingdate, p.productiongroupid, g.groupname
       ORDER BY t.estimatedaccountingdate DESC, t.operationnumber ASC`,
      [DATA_AREA, prodid],
    );
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-route-transactions failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-summary ─────────────────────────────────────────────────
// Joins production header + sales order table for enriched display on the board.
router.get("/production-summary", async (req, res): Promise<void> => {
  const fromDate = str(req.query.fromDate);
  const toDate = str(req.query.toDate);
  const productiongroupid = str(req.query.productiongroupid);
  const prodid = str(req.query.prodid);

  try {
    const pool = await getPool();
    const params: unknown[] = [DATA_AREA];

    let query = `
      SELECT DISTINCT ON (p.productionordernumber)
        p.productionordernumber                             AS prodid,
        p.dataareaid,
        COALESCE(NULLIF(p.productiongroupid, ''), '(ungrouped)') AS productiongroupid,
        p.itemnumber                                        AS itemid,
        p.productionordername                               AS itemname,
        NULLIF(TRIM(p.productconfigurationid), '')          AS productconfiguration,
        p.scheduledstartdate                                AS schedulefromdate,
        p.scheduledenddate,
        p.scheduledquantity                                 AS prodqty,
        p.productionorderstatus                             AS productionstatus,
        p.demandsalesordernumber,
         NULLIF(TRIM(p.productionpoolid), '')                AS productionpool,
         r.operationsresourceid                              AS resourcecode,
        p.remainingreportasfinishedquantity                 AS remaininventphysical,
        p.productionsiteid                                  AS siteid,
        p.productionwarehouseid                             AS warehouseid,
        s.orderingcustomeraccountnumber                     AS salescustomeraccount,
        s.ordercreationtimestamp                            AS salesorderdate,
        s.salesorderstatus,
        s.deliveryaddressname                               AS customername,
        CASE WHEN s.confirmedshippingdate > '1990-01-01' THEN s.confirmedshippingdate END AS confirmedshipdate
      FROM ${SCHEMA}.prodproductionorderheaderstaging p
       LEFT JOIN ${SCHEMA}.wrkctroperationsresourcecapacityreservationstaging r
         ON  p.productionordernumber = r.productionordernumber
         AND r.dataareaid = $1
      LEFT JOIN ${SCHEMA}.salesorderheaderv3staging s
        ON p.demandsalesordernumber = s.salesordernumber
      WHERE p.dataareaid = $1
    `;

    if (fromDate)          { params.push(fromDate);          query += ` AND p.scheduledstartdate >= $${params.length}`; }
    if (toDate)            { params.push(toDate);            query += ` AND p.scheduledenddate <= $${params.length}`; }
    if (productiongroupid) { params.push(productiongroupid); query += ` AND p.productiongroupid = $${params.length}`; }
    if (prodid)            { params.push(prodid);            query += ` AND p.productionordernumber = $${params.length}`; }

    // tomodifieddatetime DESC picks the most-recently-exported staging row when
    // multiple export jobs have written rows for the same order (append-only staging).
    query += " ORDER BY p.productionordernumber ASC, p.tomodifieddatetime DESC NULLS LAST, p.scheduledstartdate ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-summary failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-board ───────────────────────────────────────────────────
// Returns production orders enriched with their assigned resource (work center)
// from the capacity reservation table. Orders with no reservation have a null
// resourcecode and are considered "unscheduled".
router.get("/production-board", async (req, res): Promise<void> => {
  const toDate   = str(req.query.toDate);
  const productiongroupid = str(req.query.productiongroupid);

  try {
    const pool = await getPool();
    const params: unknown[] = [DATA_AREA];

    // PERF: the Schedule Board scope (Machine + classification3) lives only in
    // the released-product table. Resolving it via a plain LEFT JOIN made the
    // planner re-scan ecoresreleasedproductv2staging (~144k rows) once per
    // candidate order (nested loop), costing ~50s. Materializing the matching
    // item numbers ONCE in a CTE and hash-joining drops the query to ~2s.
    // No rp columns are projected, so this is output-identical to the join.
    let query = `
      WITH board_products AS MATERIALIZED (
        SELECT DISTINCT itemnumber
        FROM ${SCHEMA}.ecoresreleasedproductv2staging
        WHERE dataareaid = $1
          -- Combined board scope: every non-Machine released product PLUS the
          -- Machine products narrowed to the board classification3 subtypes.
          -- (Union of the former "Machine" and "Tooling" tabs = one board.)
          AND (salesclassification2 <> 'Machine'
               OR salesclassification3 IN (${SCHEDULE_BOARD_CLASS3_SQL}))
      ),
      -- The staging table is append-only: each D365 export job inserts a fresh
      -- row rather than updating the existing one, so the same order can have
      -- many rows with different statuses. We must pick the most-recently-
      -- exported row (MAX tomodifieddatetime) BEFORE applying the status=4
      -- filter — otherwise the WHERE clause eliminates status=5 rows first and
      -- DISTINCT ON is forced to pick an older status=4 row, keeping Reported-
      -- as-Finished orders on the board indefinitely.
      latest_orders AS MATERIALIZED (
        SELECT DISTINCT ON (productionordernumber)
          *
        FROM ${SCHEMA}.prodproductionorderheaderstaging
        WHERE dataareaid = $1
        ORDER BY productionordernumber, tomodifieddatetime DESC NULLS LAST
      ),
      -- BYOD export jobs may carry different subsets of fields in different
      -- runs. A partial export row (e.g. one that only updates status) can
      -- carry an empty productiongroupid even though a prior export row held
      -- the real group — so picking the single latest row silently discards
      -- the group assignment. To prevent orders vanishing from their group
      -- purely due to export-row ordering, we independently track the latest
      -- non-empty productiongroupid across all rows for each order and
      -- coalesce it over whatever the newest row carries.
      latest_group AS MATERIALIZED (
        SELECT DISTINCT ON (productionordernumber)
          productionordernumber,
          productiongroupid
        FROM ${SCHEMA}.prodproductionorderheaderstaging
        WHERE dataareaid = $1
          AND NULLIF(TRIM(productiongroupid), '') IS NOT NULL
        ORDER BY productionordernumber, tomodifieddatetime DESC NULLS LAST
      )
      SELECT DISTINCT ON (p.productionordernumber)
        p.productionordernumber                              AS prodid,
        p.dataareaid,
        COALESCE(NULLIF(TRIM(lg.productiongroupid), ''), NULLIF(TRIM(p.productiongroupid), ''), '(ungrouped)') AS productiongroupid,
        p.itemnumber                                         AS itemid,
        p.productionordername                                AS itemname,
        NULLIF(TRIM(p.productconfigurationid), '')           AS productconfiguration,
        COALESCE(rt.route_start, p.scheduledstartdate)       AS schedulefromdate,
        COALESCE(rt.route_end,   p.scheduledenddate)         AS scheduledenddate,
        p.scheduledquantity                                  AS prodqty,
        p.productionorderstatus                              AS productionstatus,
        p.demandsalesordernumber,
        CASE
          WHEN NULLIF(TRIM(p.demandsalesordernumber), '') IS NOT NULL
            THEN NULLIF(TRIM(p.demandsalesordernumber), '')
          WHEN NULLIF(TRIM(p.parentproductionordernumber), '') IS NOT NULL
               AND TRIM(p.parentproductionordernumber) != TRIM(p.productionordernumber)
            THEN NULLIF(TRIM(p.parentproductionordernumber), '')
          ELSE NULL
        END                                                  AS demandproductionordernumber,
        p.syncstartdatetime,
        NULLIF(TRIM(p.productionpoolid), '')                 AS productionpool,
        r.operationsresourceid                               AS resourcecode,
        NULLIF(TRIM(COALESCE(op.resourcename::text, '')), '') AS resourcename,
        s.orderingcustomeraccountnumber                      AS salescustomeraccount,
        s.deliveryaddressname                                AS customername,
        CASE WHEN s.confirmedshippingdate > '1990-01-01' THEN s.confirmedshippingdate END AS confirmedshipdate,
        rt.totalscheduledtime,
        rt.consumedhours,
        wk.workername
      FROM latest_orders p
      LEFT JOIN latest_group lg ON lg.productionordernumber = p.productionordernumber
      LEFT JOIN board_products bp
        ON bp.itemnumber = p.itemnumber
      LEFT JOIN ${SCHEMA}.wrkctroperationsresourcecapacityreservationstaging r
        ON  p.productionordernumber = r.productionordernumber
        AND r.dataareaid = $1
      LEFT JOIN ${SCHEMA}.opresoperationsresourcestaging op
        ON  r.operationsresourceid = op.resourceid
        AND op.dataareaid = $1
      LEFT JOIN ${SCHEMA}.salesorderheaderv3staging s
        ON p.demandsalesordernumber = s.salesordernumber
      LEFT JOIN (
        -- Per-order route rollup sourced DIRECTLY from the staging tables rather
        -- than productionroutedetailsd365(). That function wraps another
        -- set-returning function with a GROUP BY, so it full-scans every order
        -- (57s+ on this dataset). The direct query over the underlying tables
        -- produces the identical figures in ~0.6s. Columns mirror the function:
        --   estimatedsetuptime/estimatedprocesstime  -> totalscheduledtime
        --   posted registeredhours per op            -> consumedhours
        --   scheduledfromdate/scheduledenddate       -> route window
        --
        -- prodproductionorderrouteoperationstaging has 2 rows per
        -- (productionordernumber, operationnumber) from two D365 export jobs
        -- with different operationid values. Deduplicate to ONE row first so
        -- SUM(setup+process) = totalscheduledtime is not doubled.
        -- consumedhours comes from prodproductionroutetransactionstaging (the
        -- posted-transactions ledger) — same source as the detail drill-down —
        -- so the board card and detail view always agree.
        SELECT ro.productionordernumber,
               SUM(COALESCE(ro.estimatedsetuptime, 0) + COALESCE(ro.estimatedprocesstime, 0)) AS totalscheduledtime,
               -- Hours actually posted (registered) so far, EXCLUDING the warehouse
               -- bookend operations, so it lines up with totalscheduledtime above.
               SUM(COALESCE(jh.posted_hours, 0)) FILTER (
                 WHERE rop.operationname NOT ILIKE 'Warehouse Pick%'
                   AND rop.operationname NOT ILIKE 'Warehouse Receive%'
               ) AS consumedhours,
               -- Production window EXCLUDING the warehouse bookend operations: the
               -- leading "Warehouse Pick for ..." (production pick for items) and the
               -- trailing "Warehouse Receive ..." (pick/receive of the built product).
               -- The pick is always the earliest op and the receive the latest, so
               -- MIN/MAX over the remaining ops = the first real production op (after
               -- the pick) and the last real production op (before the receive).
               MIN(ro.scheduledfromdate) FILTER (
                 WHERE ro.scheduledfromdate > '1990-01-01'
                   AND rop.operationname NOT ILIKE 'Warehouse Pick%'
                   AND rop.operationname NOT ILIKE 'Warehouse Receive%'
               ) AS route_start,
               MAX(ro.scheduledenddate) FILTER (
                 WHERE ro.scheduledenddate > '1990-01-01'
                   AND rop.operationname NOT ILIKE 'Warehouse Pick%'
                   AND rop.operationname NOT ILIKE 'Warehouse Receive%'
               ) AS route_end
        FROM (
          SELECT DISTINCT ON (productionordernumber, operationnumber)
            productionordernumber, dataareaid, operationnumber, operationid,
            estimatedsetuptime, estimatedprocesstime, scheduledfromdate, scheduledenddate
          FROM ${SCHEMA}.prodproductionorderrouteoperationstaging
          WHERE dataareaid = $1
          ORDER BY productionordernumber, operationnumber, operationid DESC
        ) ro
        JOIN ${SCHEMA}.routeoperationstaging rop
          ON  rop.operationid = ro.operationid
          AND rop.dataareaid  = ro.dataareaid
        LEFT JOIN (
          -- Posted-transactions ledger matches the detail drill-down view.
          -- torefnumber = production order number; operationnumber = route op.
          SELECT t.torefnumber::text AS productionordernumber,
                 t.operationnumber::text AS operationnumber,
                 SUM(t.registeredhours) AS posted_hours
          FROM ${SCHEMA}.prodproductionroutetransactionstaging t
          WHERE t.dataareaid = $1 AND t.registeredhours > 0
          GROUP BY t.torefnumber, t.operationnumber
        ) jh
          ON  jh.productionordernumber = ro.productionordernumber
          AND jh.operationnumber       = ro.operationnumber::text
        GROUP BY ro.productionordernumber
      ) rt ON p.productionordernumber = rt.productionordernumber
      LEFT JOIN (
        SELECT t.torefnumber,
               STRING_AGG(DISTINCT w.name, '; ' ORDER BY w.name) AS workername
        FROM ${SCHEMA}.prodproductionroutetransactionstaging t
        JOIN ${SCHEMA}.hcmworkerstaging w ON w.recid = t.toworker
        WHERE t.dataareaid = $1 AND t.toworker IS NOT NULL AND t.toworker <> 0
        GROUP BY t.torefnumber
      ) wk ON p.productionordernumber = wk.torefnumber
      WHERE p.productionorderstatus = ${STATUS_STARTED}
        -- board_products scope applies to the resource-group sections only.
        -- Unallocated-section groups are shown regardless of sales classification
        -- so mis-classified orders surface.
        -- Use the coalesced group (latest non-empty across all export rows) for
        -- the Unallocated bypass — same logic as the productiongroupid column above.
        AND (bp.itemnumber IS NOT NULL
             OR COALESCE(NULLIF(TRIM(lg.productiongroupid), ''), NULLIF(TRIM(p.productiongroupid), ''))
                  IN ('GenAssy', 'GenInstr', 'GenElec', 'Elec Setup'))
    `;

    // Upper-bound only. We deliberately DROP the lower (fromDate) bound: every
    // board row is a STATUS_STARTED (in-progress) order, and those must stay on
    // the board until completed — even when their whole schedule has already
    // slipped into the past. The frontend pins such overdue orders to the first
    // visible column so they remain visible.
    if (toDate)            { params.push(toDate);            query += ` AND COALESCE(rt.route_start, p.scheduledstartdate) <= $${params.length}`; }
    // NOTE: the productiongroupid filter is applied in JS below (after the
    // local override overlay) so that orders moved INTO or OUT OF a group via
    // a recent D365 write-back are filtered against their NEW group, not the
    // stale staging value.

    // latest_orders CTE already reduced the header table to one row per order
    // (most recent tomodifieddatetime). The outer DISTINCT ON here handles the
    // capacity-reservation fan-out (one reservation row per order).
    query += " ORDER BY p.productionordernumber, r.reservationdate ASC NULLS LAST";

    const result = await pool.query(query, params);
    let rows = result.rows as {
      prodid: string; productiongroupid: string; groupsyncpending?: boolean;
      schedulefromdate?: unknown; scheduledenddate?: unknown;
      totalscheduledtime?: number | string | null; expectedconsumedhours?: number | null;
    }[];

    // Pace: how many hours SHOULD be posted by now, given the production
    // window (route start/end excl. warehouse bookends, already coalesced into
    // schedulefromdate/scheduledenddate) spread evenly over Mon–Fri workdays.
    const now = new Date();
    for (const row of rows) {
      row.expectedconsumedhours = expectedConsumedHours(
        row.totalscheduledtime == null ? null : Number(row.totalscheduledtime),
        row.schedulefromdate,
        row.scheduledenddate,
        now,
      );
    }

    // Overlay local production-group overrides (changes written to D365 that
    // the staging mirror hasn't picked up yet). Once staging reflects the new
    // group, the override is deleted — staging is the source of truth again.
    // Overlaid rows are flagged groupsyncpending so the UI can show a sync
    // indicator until the mirror catches up.
    //
    // Stale-override guard: if an override is older than 2 hours and staging
    // still shows a DIFFERENT group, it means D365/CRM independently moved the
    // order elsewhere (e.g. back to Unallocated) and the BYOD export has since
    // captured that change. The override is stale in the reverse direction and
    // must be cleared so staging wins — otherwise the order disappears from its
    // actual group indefinitely.
    const overrides = await db.select().from(productionGroupOverridesTable);
    if (overrides.length > 0) {
      const STALE_OVERRIDE_MS = 2 * 60 * 60 * 1000; // 2 hours
      // Minimum age before a "caught-up" overlay may be removed. The overlay
      // timestamp drives other clients' 60 s sync probe; deleting it instantly
      // reverts overlaylastupdated before they ever see it, so they miss the
      // change entirely. 90 s guarantees at least one full probe cycle fires.
      const MIN_OVERLAY_AGE_MS = 90 * 1000; // 90 seconds
      const overrideMap = new Map(overrides.map((o) => [o.prodid, o]));
      const caughtUp: string[] = [];
      for (const row of rows) {
        const override = overrideMap.get(row.prodid);
        if (override === undefined) continue;
        const ageMs = Date.now() - override.updatedAt.getTime();
        if (row.productiongroupid === override.groupid && ageMs >= MIN_OVERLAY_AGE_MS) {
          // Staging has caught up to the override value AND enough time has
          // passed for all other clients to have seen the elevated
          // overlaylastupdated timestamp — safe to remove.
          caughtUp.push(row.prodid);
        } else if (row.productiongroupid === override.groupid) {
          // Staging matches but the overlay is too fresh to delete yet.
          // Keep it so other clients' next probe cycle sees the timestamp.
          row.groupsyncpending = true;
        } else if (ageMs > STALE_OVERRIDE_MS) {
          // Override is >2 h old and staging shows a different group: D365 has
          // independently changed the assignment since the override was written.
          // Clear the stale override so the board reflects staging again.
          caughtUp.push(row.prodid);
          logger.warn(
            { prodid: row.prodid, overrideGroup: override.groupid, stagingGroup: row.productiongroupid },
            "stale production-group override detected (>2 h, staging diverged); clearing",
          );
        } else {
          // Override is fresh; staging hasn't caught up yet — apply it.
          row.productiongroupid = override.groupid;
          row.groupsyncpending = true;
        }
      }
      if (caughtUp.length > 0) {
        await db
          .delete(productionGroupOverridesTable)
          .where(inArray(productionGroupOverridesTable.prodid, caughtUp));
        logger.info({ caughtUp }, "production-group overrides caught up or expired; removed");
      }
    }

    if (productiongroupid) rows = rows.filter((r) => r.productiongroupid === productiongroupid);
    res.json(rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-board failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /production-orders/:prodid/production-group ──────────────────────
// Changes a production order's production group. The change is written to
// Dynamics 365 F&O in REAL TIME via the OData TO_SOProdTable custom entity
// (the standard ProductionOrderHeaders entity rejects non-Created orders);
// only after D365 accepts it is a local overlay stored so the board shows the
// new group immediately (the Azure PG staging mirror refreshes on a lag).
router.patch("/production-orders/:prodid/production-group", async (req, res): Promise<void> => {
  const prodid = req.params.prodid;
  const groupid = typeof req.body?.groupid === "string" ? req.body.groupid.trim() : "";

  if (!prodid || !groupid) {
    res.status(400).json({ error: "invalid_request", message: "prodid and groupid are required" });
    return;
  }

  try {
    // Validate the group exists in D365 (via the staging lookup table).
    const pool = await getPool();
    const groupCheck = await pool.query(
      `SELECT 1 FROM ${SCHEMA}.costproductiongroupstaging WHERE dataareaid = $1 AND groupid = $2 LIMIT 1`,
      [DATA_AREA, groupid],
    );
    if (groupCheck.rowCount === 0) {
      res.status(400).json({ error: "unknown_group", message: `Production group '${groupid}' does not exist` });
      return;
    }

    // Write to D365 FIRST — the local overlay is only stored once D365 has
    // accepted the change, so the board never shows a group D365 rejected.
    await updateProductionGroupInD365(DATA_AREA, prodid, groupid);

    await db
      .insert(productionGroupOverridesTable)
      .values({ prodid, groupid })
      .onConflictDoUpdate({
        target: productionGroupOverridesTable.prodid,
        set: { groupid, updatedAt: new Date() },
      });

    res.json({ ok: true, prodid, groupid });
  } catch (err: unknown) {
    if (err instanceof D365Error) {
      res.status(502).json({ error: "d365_error", message: err.message });
      return;
    }
    logger.error({ err }, "update production group failed");
    res.status(500).json({ error: "server_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-kpi ─────────────────────────────────────────────────────
// Per-order performance / delivery KPIs for STARTED Machine orders in the
// Assy/Inst production groups. Posting dates come from the route-card production
// journal (prodroutecardproductionjournalentrystaging.posteddatetime, isposted=1),
// EXCLUDING the warehouse pick/receive operations. Delivery date and total
// scheduled Hours are the Schedule Board values: the route window MAX(scheduled
// end) and SUM(setup+process) over the non-warehouse route operations. Only
// orders with at least one non-warehouse posting are returned. The D365 sentinel
// (1900-01-01) is treated as null.
router.get("/production-kpi", async (req, res): Promise<void> => {
  const fromDate = str(req.query.fromDate);
  const toDate   = str(req.query.toDate);
  const productiongroupid = str(req.query.productiongroupid);
  const prodid = str(req.query.prodid);

  try {
    const pool = await getPool();
    const params: unknown[] = [DATA_AREA];

    // Optional single-order restriction (used by the order-detail KPI summary).
    let prodidClause = "";
    if (prodid) {
      params.push(prodid);
      prodidClause = ` AND p.productionordernumber = $${params.length}`;
    }

    let query = `
      WITH kpi_orders AS MATERIALIZED (
        SELECT
          p.productionordernumber,
          p.dataareaid,
          COALESCE(NULLIF(p.productiongroupid, ''), '(ungrouped)') AS productiongroupid,
          p.itemnumber                                         AS itemid,
          p.productionordername                                AS itemname,
          p.productionorderstatus                              AS productionstatus
        FROM ${SCHEMA}.prodproductionorderheaderstaging p
        -- KPI page: Machine orders in the KPI groups only. Single-order banner
        -- (prodid given): every started order regardless of classification/group.
        -- EXISTS (not a join) so duplicate released-product rows can neither
        -- multiply orders nor arbitrarily change Machine inclusion.
        WHERE p.dataareaid = $1
          AND p.productionorderstatus = ${STATUS_STARTED}${prodid ? "" : `
          AND EXISTS (
            SELECT 1 FROM ${SCHEMA}.ecoresreleasedproductv2staging rp
            WHERE rp.itemnumber = p.itemnumber
              AND rp.dataareaid = $1
              AND rp.salesclassification2 = 'Machine'
          )
          AND p.productiongroupid IN (${KPI_GROUPS_SQL})`}${prodidClause}
      ),
      route AS MATERIALIZED (
        -- Source the route operations directly from the staging tables rather
        -- than productionroutedetailsd365(): that SQL function wraps another
        -- set-returning function with a GROUP BY, so an order-number predicate
        -- cannot push through it and it full-scans every order (40s+). Querying
        -- the underlying tables with the kpi_orders filter is index-friendly
        -- (~150ms). Columns mirror what the function exposed.
        --
        -- prodproductionorderrouteoperationstaging has 2 rows per
        -- (productionordernumber, operationnumber) from two D365 export jobs
        -- with different operationid values. Deduplicate to ONE row first so
        -- route_agg SUM(setup+process) = scheduledHours is not doubled.
        SELECT
          dedup.productionordernumber,
          dedup.operationnumber::text                          AS operationnumber,
          r.operationname::text                                AS operationname,
          dedup.estimatedsetuptime,
          dedup.estimatedprocesstime,
          dedup.scheduledenddate
        FROM (
          SELECT DISTINCT ON (productionordernumber, operationnumber)
            productionordernumber, dataareaid, operationnumber, operationid,
            estimatedsetuptime, estimatedprocesstime, scheduledenddate
          FROM ${SCHEMA}.prodproductionorderrouteoperationstaging
          WHERE dataareaid = $1
            AND productionordernumber IN (SELECT productionordernumber FROM kpi_orders)
          ORDER BY productionordernumber, operationnumber, operationid DESC
        ) dedup
        JOIN ${SCHEMA}.routeoperationstaging r
          ON  r.operationid = dedup.operationid
          AND r.dataareaid  = dedup.dataareaid
      ),
      route_agg AS (
        SELECT
          productionordernumber,
          SUM(COALESCE(estimatedsetuptime, 0) + COALESCE(estimatedprocesstime, 0)) FILTER (
            WHERE operationname NOT ILIKE 'Warehouse Pick%'
              AND operationname NOT ILIKE 'Warehouse Receive%'
          )::float8                                            AS hours,
          MAX(scheduledenddate) FILTER (
            WHERE scheduledenddate > '1990-01-01'
              AND operationname NOT ILIKE 'Warehouse Pick%'
              AND operationname NOT ILIKE 'Warehouse Receive%'
          )                                                    AS delivery
        FROM route
        GROUP BY productionordernumber
      ),
      journal AS MATERIALIZED (
        SELECT
          j.productionordernumber,
          rd.operationname,
          j.posteddatetime,
          COALESCE(j.registeredhours, 0)                       AS registeredhours
        FROM ${SCHEMA}.prodroutecardproductionjournalentrystaging j
        -- Dedupe route rows to one per (order, operation number): staging data
        -- contains duplicate (order, op) pairs which would otherwise multiply
        -- journal rows and inflate the posted-hours sums.
        JOIN (
          SELECT DISTINCT ON (productionordernumber, operationnumber)
            productionordernumber, operationnumber, operationname
          FROM route
          WHERE operationnumber ~ '^[0-9]+$'
          ORDER BY productionordernumber, operationnumber, operationname
        ) rd
          ON  rd.productionordernumber = j.productionordernumber
          AND rd.operationnumber::int = j.routeoperationnumber
        WHERE j.dataareaid = $1
          AND j.isposted = 1
          AND j.posteddatetime > '1990-01-01'
          AND j.productionordernumber IN (SELECT productionordernumber FROM kpi_orders)
          AND rd.operationname NOT ILIKE 'Warehouse Pick%'
          AND rd.operationname NOT ILIKE 'Warehouse Receive%'
      ),
      postings AS (
        SELECT
          productionordernumber,
          MIN(posteddatetime)                                  AS firstposting,
          MAX(posteddatetime)                                  AS lastposting,
          COUNT(DISTINCT posteddatetime::date)                 AS activedays,
          SUM(registeredhours) FILTER (
            WHERE operationname ILIKE 'Assemble / Build%'
          )::float8                                            AS assemblehours
        FROM journal
        GROUP BY productionordernumber
      ),
      top_op AS (
        SELECT DISTINCT ON (productionordernumber)
          productionordernumber,
          operationname
        FROM (
          SELECT productionordernumber, operationname,
                 SUM(registeredhours) AS hrs, COUNT(*) AS cnt
          FROM journal
          GROUP BY productionordernumber, operationname
        ) oh
        ORDER BY productionordernumber, hrs DESC NULLS LAST, cnt DESC
      )
      SELECT
        k.productionordernumber                               AS prodid,
        k.dataareaid,
        k.productiongroupid,
        k.itemid,
        k.itemname,
        k.productionstatus,
        top.operationname                                     AS operation,
        ra.hours,
        ra.delivery,
        po.firstposting,
        po.lastposting,
        po.activedays::integer                                AS activedays,
        po.assemblehours
      FROM kpi_orders k
      -- The KPI page lists only orders with production postings (INNER JOIN),
      -- but the single-order detail banner shows every started order, with
      -- null posting fields until work is posted (LEFT JOIN).
      ${prodid ? "LEFT JOIN" : "JOIN"} postings po ON po.productionordernumber = k.productionordernumber
      LEFT JOIN route_agg ra ON ra.productionordernumber = k.productionordernumber
      LEFT JOIN top_op top   ON top.productionordernumber = k.productionordernumber
      WHERE 1 = 1
    `;

    if (fromDate)          { params.push(fromDate);          query += ` AND po.lastposting >= $${params.length}`; }
    if (toDate)            { params.push(toDate);            query += ` AND po.lastposting <= $${params.length}`; }
    if (productiongroupid) { params.push(productiongroupid); query += ` AND k.productiongroupid = $${params.length}`; }

    query += " ORDER BY po.lastposting DESC NULLS LAST, k.productionordernumber ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-kpi failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-groups ──────────────────────────────────────────────────
// Small lookup of production group id -> display name (costproductiongroupstaging).
// Used by the Schedule Board to label section headers with the human-readable
// group name instead of the raw group id (including empty groups with no orders).
router.get("/production-groups", async (_req, res): Promise<void> => {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT groupid, NULLIF(TRIM(groupname), '') AS groupname
       FROM ${SCHEMA}.costproductiongroupstaging
       WHERE dataareaid = $1
       ORDER BY groupid`,
      [DATA_AREA],
    );
    res.json(result.rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-groups failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-sync-status ─────────────────────────────────────────────
// Lightweight freshness probe: returns the most recent D365 → staging sync
// timestamp AND the most recent local production-group override timestamp.
// Clients poll this cheaply and refetch the full board data when either value
// advances — so a group move made by any manager surfaces on every open board
// within one probe cycle (≈60 s) without waiting for the next D365 export.
router.get("/production-sync-status", async (_req, res): Promise<void> => {
  try {
    const pool = await getPool();
    const [stagingResult, overlayResult] = await Promise.all([
      pool.query(
        `SELECT MAX(syncstartdatetime) AS lastsync
         FROM ${SCHEMA}.prodproductionorderheaderstaging
         WHERE dataareaid = $1`,
        [DATA_AREA],
      ),
      // Single-row MAX — avoids fetching every override row to reduce in JS.
      pool.query(`SELECT MAX(updated_at) AS overlaylastupdated FROM production_group_overrides`),
    ]);
    const lastsync: Date | string | null = stagingResult.rows[0]?.lastsync ?? null;
    const latestOverlay: Date | string | null = overlayResult.rows[0]?.overlaylastupdated ?? null;
    res.json({
      lastsync: lastsync instanceof Date ? lastsync.toISOString() : lastsync,
      overlaylastupdated: latestOverlay instanceof Date ? latestOverlay.toISOString() : latestOverlay,
    });
  } catch (err: unknown) {
    logger.error({ err }, "production-sync-status failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /unallocated-order-details ──────────────────────────────────────────
// Raw production-order data grid for the Schedule Board "Unallocated" section:
// every Started GenAssy / GenInstr production order with
// its released-product sales classifications and quantity.
router.get("/unallocated-order-details", async (_req, res): Promise<void> => {
  try {
    const pool = await getPool();
    const result = await pool.query(
      `SELECT
         p.productionordernumber,
         p.itemnumber,
         p.productionordername                                AS productionname,
         p.productiongroupid                                  AS productiongroup,
         NULLIF(TRIM(p.productionpoolid), '')                 AS productionpool,
         NULLIF(TRIM(rp.tosalesclass1), '')                   AS salesclassification1,
         NULLIF(TRIM(rp.salesclassification2), '')            AS salesclassification2,
         NULLIF(TRIM(rp.salesclassification3), '')            AS salesclassification3,
         p.productionorderstatus,
         p.scheduledquantity::float8                          AS quantity
       FROM ${SCHEMA}.prodproductionorderheaderstaging p
       LEFT JOIN (
         -- Guard against duplicate released-product rows per item (would
         -- duplicate production orders in the grid).
         SELECT DISTINCT ON (itemnumber)
           itemnumber, tosalesclass1, salesclassification2, salesclassification3
         FROM ${SCHEMA}.ecoresreleasedproductv2staging
         WHERE dataareaid = $1
         ORDER BY itemnumber
       ) rp
         ON rp.itemnumber = p.itemnumber
       WHERE p.dataareaid = $1
         AND p.productiongroupid IN ('GenAssy', 'GenInstr', 'GenElec', 'Elec Setup')
         AND p.productionorderstatus = ${STATUS_STARTED}
       ORDER BY p.productionordernumber`,
      [DATA_AREA],
    );

    // Apply the same production-group-override logic as /production-board so
    // this grid stays consistent with the board view.  If a local override has
    // re-assigned an order to a non-unallocated group (e.g. ASSY02) we must
    // hide it here even though staging still shows an unallocated group.
    const UNALLOCATED_GROUPS = new Set(["GenAssy", "GenInstr", "GenElec", "Elec Setup"]);
    const overrides = await db.select().from(productionGroupOverridesTable);
    let rows: typeof result.rows = result.rows;
    if (overrides.length > 0) {
      const overrideMap = new Map(overrides.map((o) => [o.prodid, o.groupid]));
      rows = result.rows.filter((row: { productionordernumber: string }) => {
        const overriddenGroup = overrideMap.get(row.productionordernumber);
        // No override → keep. Override points to unallocated group → keep.
        // Override points elsewhere (e.g. ASSY02) → suppress from this list.
        return overriddenGroup === undefined || UNALLOCATED_GROUPS.has(overriddenGroup);
      });
    }
    res.json(rows);
  } catch (err: unknown) {
    logger.error({ err }, "unallocated-order-details failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-picking ─────────────────────────────────────────────────
// Per-order component pick status for Schedule Board cards: for every started
// machine order, the BOM component lines that still have quantity remaining to
// pick. Remaining is read directly from the BOM line's remainingbomlinequantity
// column (with its bomlineunitsymbol unit); only lines where it is non-zero are
// returned.
//
// The BOM staging table is large and unindexed (read-only D365 source), so this
// aggregate full-scans it (~10s). It is therefore cached in-memory with a short
// TTL and fetched by the client separately from the board so it never blocks the
// board from rendering.
type PickItem = { itemnumber: string; description: string | null; remaining: number; unit: string | null };
type PickRemaining = { prodid: string; items: PickItem[] };
let pickCache: { ts: number; data: PickRemaining[] } | null = null;
const PICK_CACHE_TTL_MS = 5 * 60 * 1000;

router.get("/production-picking", async (_req, res): Promise<void> => {
  try {
    if (pickCache && Date.now() - pickCache.ts < PICK_CACHE_TTL_MS) {
      res.json(pickCache.data);
      return;
    }
    const pool = await getPool();
    const query = `
      WITH board_products AS MATERIALIZED (
        SELECT DISTINCT itemnumber
        FROM ${SCHEMA}.ecoresreleasedproductv2staging
        WHERE dataareaid = $1
          AND salesclassification2 = 'Machine'
          AND salesclassification3 IN (${SCHEDULE_BOARD_CLASS3_SQL})
      ),
      board_orders AS MATERIALIZED (
        SELECT DISTINCT p.productionordernumber
        FROM ${SCHEMA}.prodproductionorderheaderstaging p
        LEFT JOIN board_products bp ON bp.itemnumber = p.itemnumber
        WHERE p.dataareaid = $1 AND p.productionorderstatus = ${STATUS_STARTED}
          -- Mirror /production-board scope: Machine items from classification list,
          -- plus unallocated-section groups shown regardless of classification.
          AND (bp.itemnumber IS NOT NULL OR p.productiongroupid IN ('GenAssy', 'GenInstr', 'GenElec', 'Elec Setup'))
      ),
      lines AS (
        -- A component can span multiple BOM lines; sum the remaining qty so it
        -- appears once per item in the tooltip. Keep only non-zero remainders.
        SELECT bl.productionordernumber,
               bl.itemnumber,
               NULLIF(TRIM(MAX(bl.bomlineunitsymbol)), '') AS unit,
               SUM(COALESCE(bl.remainingbomlinequantity, 0))::float8 AS remaining
        FROM ${SCHEMA}.prodproductionorderbillofmaterialslinestaging bl
        JOIN board_orders bo ON bo.productionordernumber = bl.productionordernumber
        WHERE bl.dataareaid = $1
        GROUP BY bl.productionordernumber, bl.itemnumber
        HAVING SUM(COALESCE(bl.remainingbomlinequantity, 0)) <> 0
      )
      SELECT l.productionordernumber AS prodid,
             json_agg(
               json_build_object(
                 'itemnumber',  l.itemnumber,
                 'description', COALESCE(NULLIF(TRIM(p.productname), ''), NULLIF(TRIM(rp.searchname), '')),
                 'remaining',   l.remaining,
                 'unit',        l.unit
               )
               ORDER BY l.itemnumber
             ) AS items
      FROM lines l
      LEFT JOIN ${SCHEMA}.ecoresreleasedproductv2staging rp
        ON  rp.itemnumber = l.itemnumber
        AND rp.dataareaid = $1
      LEFT JOIN ${SCHEMA}.ecoresproductv2staging p
        ON  p.productnumber = rp.productnumber
      GROUP BY l.productionordernumber
    `;
    const result = await pool.query(query, [DATA_AREA]);
    pickCache = { ts: Date.now(), data: result.rows as PickRemaining[] };
    res.json(pickCache.data);
  } catch (err: unknown) {
    logger.error({ err }, "production-picking failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /production-utilization ─────────────────────────────────────────────
// Posted (registered) labor hours for a week window, one row per
// group/worker/order/operation/day. Drives the weekly Resource Utilization
// section: sum per group = worked hours vs the 8h × Mon–Fri capacity, plus a
// per-day / per-operation / per-order drill-down.
//
// Attribution: each board production group is a PERSON (e.g. Assy05 = Drew P),
// so hours are attributed to the group of the WORKER who posted the time
// (route transactions carry the worker), regardless of which order they
// worked on. Postings by workers without a board group fall back to the
// order's production group (keeps Paint / Inst03 / non-board groups sensible).
// Excludes Warehouse Pick/Receive bookend operations (not production labor).

// Worker (HcmWorker personnelnumber) → board production group. Groups are
// named after their person in D365 ("Assy05-Drew P"); verified against
// posting history. Update here when a group changes hands.
const WORKER_GROUP_MAP: [personnelNumber: string, groupId: string][] = [
  ["943",     "Assy01"], // Dickson, Michael  ("Assy01-Mike D")
  ["152",     "Assy02"], // Redstreake, John  ("Assy02-John R")
  ["157",     "Assy03"], // Moyer, Bobby      ("Assy03-Bobby M")
  ["1020",    "Assy04"], // Lecco, Mike       ("Assy04- Michael L")
  ["US-1025", "Assy05"], // Prentice, Drew    ("Assy05-Drew P")
  ["0951",    "Assy06"], // Mathew Abraham    ("Assy06-Matt A")
  ["US-1049", "Assy07"], // Cohen, Kyle       ("Assy07-Kyle")
  ["US-984",  "Assy09"], // Sokalski, Shaun   ("Assy09-Shaun S")
  ["1083",    "Assy10"], // McCarthy, Ryley   ("Assy10-Ryley M")
  ["170",     "Inst01"], // Barndt, Rodney    ("Instr01- Rodney")
  ["US1045",  "Inst02"], // Barrilli, David   ("Instr02 - David")
];

router.get("/production-utilization", async (req, res): Promise<void> => {
  const fromDate = str(req.query.fromDate);
  const toDate   = str(req.query.toDate);

  try {
    const pool = await getPool();
    const mapValues = WORKER_GROUP_MAP
      .map((_, i) => `($${4 + i * 2}, $${5 + i * 2})`)
      .join(", ");
    const query = `
      WITH worker_group(personnelnumber, groupid) AS (VALUES ${mapValues})
      SELECT
        COALESCE(wg.groupid, NULLIF(p.productiongroupid, ''), '(ungrouped)') AS productiongroupid,
        (wg.groupid IS NOT NULL)                                 AS byworker,
        NULLIF(TRIM(h.name), '')                                 AS resourcecode,
        t.torefnumber::text                                      AS prodid,
        p.productionordername                                    AS itemname,
        t.operationnumber                                        AS operationnumber,
        NULLIF(TRIM(rop.operationname), '')                      AS operationname,
        to_char(t.estimatedaccountingdate, 'YYYY-MM-DD')         AS day,
        SUM(t.registeredhours)::float8                           AS postedhours
      FROM ${SCHEMA}.prodproductionroutetransactionstaging t
      LEFT JOIN ${SCHEMA}.hcmworkerstaging h
        ON  h.recid = t.toworker
      LEFT JOIN worker_group wg
        ON  wg.personnelnumber = h.personnelnumber
      -- prodproductionorderheaderstaging has 3 rows per order (one per D365
      -- export job). Deduplicate to ONE row per order before joining to avoid
      -- a 3× fan-out that would triple every hours sum.
      LEFT JOIN (
        SELECT DISTINCT ON (productionordernumber, dataareaid)
          productionordernumber, dataareaid, productiongroupid, productionordername
        FROM ${SCHEMA}.prodproductionorderheaderstaging
        ORDER BY productionordernumber, dataareaid, tomodifieddatetime DESC NULLS LAST
      ) p
        ON  p.productionordernumber = t.torefnumber::text
        AND p.dataareaid = t.dataareaid
      LEFT JOIN ${SCHEMA}.routeoperationstaging rop
        ON  rop.operationid = t.operationid
        AND rop.dataareaid  = t.dataareaid
      WHERE t.dataareaid = $1
        AND t.registeredhours > 0
        AND t.estimatedaccountingdate >= $2::date
        AND t.estimatedaccountingdate <  ($3::date + INTERVAL '1 day')
        AND COALESCE(rop.operationname, '') NOT ILIKE 'Warehouse Pick%'
        AND COALESCE(rop.operationname, '') NOT ILIKE 'Warehouse Receive%'
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      ORDER BY 1, 4, 6, 8
    `;
    const params = [DATA_AREA, fromDate, toDate, ...WORKER_GROUP_MAP.flat()];
    const result = await pool.query(query, params);
    const rows = result.rows as { prodid: string; productiongroupid: string; byworker: boolean }[];

    // Overlay local production-group overrides (group changes written to D365
    // that the staging mirror hasn't picked up yet) so an order's posted hours
    // count under its NEW group immediately — but only for rows attributed by
    // the ORDER's group; worker-attributed rows follow the person, not the order.
    const overrides = await db.select().from(productionGroupOverridesTable);
    if (overrides.length > 0) {
      const overrideMap = new Map(overrides.map((o) => [o.prodid, o.groupid]));
      for (const row of rows) {
        if (row.byworker) continue;
        const g = overrideMap.get(row.prodid);
        if (g !== undefined && row.productiongroupid !== g) row.productiongroupid = g;
      }
    }

    res.json(rows);
  } catch (err: unknown) {
    logger.error({ err }, "production-utilization failed");
    res.status(500).json({ error: "database_error", message: err instanceof Error ? err.message : String(err) });
  }
});

// POST /storeroom-request — sends a part-request email to the storeroom via
// Exchange Online (Microsoft Graph). Requires STOREROOM_EMAIL and
// STOREROOM_SENDER_MAILBOX env vars plus the Graph "Mail.Send" application
// permission on the Azure app registration.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/storeroom-request", async (req, res) => {
  const { prodid, subject, message, requestedBy, fromEmail, toEmail, cc } = req.body ?? {};

  // Per-request addresses override the configured defaults.
  // Default TO: DTait@tiniusolsen.com; default CC: CKnabb + DGoodwin.
  const DEFAULT_TO = "DTait@tiniusolsen.com";
  const DEFAULT_CC = ["CKnabb@tiniusolsen.com", "DGoodwin@tiniusolsen.com"];

  const storeroomEmail =
    (typeof toEmail === "string" && toEmail.trim()) || process.env.STOREROOM_EMAIL || DEFAULT_TO;
  const senderMailbox =
    (typeof fromEmail === "string" && fromEmail.trim()) || process.env.STOREROOM_SENDER_MAILBOX;
  if (!storeroomEmail || !senderMailbox) {
    res.status(503).json({
      error: "not_configured",
      message:
        "Please fill in your From email address.",
    });
    return;
  }

  // CC: merge request-provided list with the hardcoded defaults
  const ccList: string[] = [
    ...DEFAULT_CC,
    ...(Array.isArray(cc) ? cc.filter((a: unknown) => typeof a === "string" && a.trim()) : []),
  ];
  if (!EMAIL_RE.test(storeroomEmail)) {
    res.status(400).json({ error: "bad_request", message: `"${storeroomEmail}" is not a valid To email address` });
    return;
  }
  if (!EMAIL_RE.test(senderMailbox)) {
    res.status(400).json({ error: "bad_request", message: `"${senderMailbox}" is not a valid From email address` });
    return;
  }

  if (typeof prodid !== "string" || prodid.trim() === "") {
    res.status(400).json({ error: "bad_request", message: "prodid is required" });
    return;
  }
  if (typeof subject !== "string" || subject.trim() === "") {
    res.status(400).json({ error: "bad_request", message: "subject is required" });
    return;
  }
  if (typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "bad_request", message: "message is required" });
    return;
  }
  if (subject.length > 300 || message.length > 5000) {
    res.status(400).json({ error: "bad_request", message: "subject or message too long" });
    return;
  }

  const fromLine =
    typeof requestedBy === "string" && requestedBy.trim() !== ""
      ? `\n\nRequested by: ${requestedBy.trim()}`
      : "";
  const body =
    `Part request for production order ${prodid.trim()}\n\n` +
    `${message.trim()}${fromLine}\n\n` +
    `-- Sent from the Production Shop Floor app`;

  try {
    await sendMailViaGraph({
      fromMailbox: senderMailbox,
      to: storeroomEmail,
      cc: ccList,
      subject: subject.trim(),
      body,
    });
    res.json({ sent: true });
  } catch (err: unknown) {
    if (err instanceof GraphMailError) {
      logger.error({ err: err.message, status: err.status }, "storeroom-request failed");
      res.status(502).json({ error: "mail_error", message: err.message });
      return;
    }
    logger.error({ err }, "storeroom-request failed");
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// POST /calibration-request — sends a calibration-ready email via Exchange Online.
// Fixed recipient: BWood@tiniusolsen.com. From mailbox supplied by the caller
// (the logged-in user's email). Subject is supplied by the caller. Body: "{ordername} is ready for calibration".
router.post("/calibration-request", async (req, res) => {
  const { prodid, fromEmail, ordername, subject } = req.body ?? {};

  const CALIBRATION_TO = "BWood@tiniusolsen.com";

  const senderMailbox = typeof fromEmail === "string" ? fromEmail.trim() : "";
  if (!senderMailbox) {
    res.status(503).json({ error: "not_configured", message: "Please fill in your From email address." });
    return;
  }
  if (!EMAIL_RE.test(senderMailbox)) {
    res.status(400).json({ error: "bad_request", message: `"${senderMailbox}" is not a valid From email address` });
    return;
  }
  if (typeof prodid !== "string" || prodid.trim() === "") {
    res.status(400).json({ error: "bad_request", message: "prodid is required" });
    return;
  }
  if (typeof subject !== "string" || subject.trim() === "") {
    res.status(400).json({ error: "bad_request", message: "subject is required" });
    return;
  }

  const orderLabel = typeof ordername === "string" && ordername.trim() ? ordername.trim() : prodid.trim();
  const body =
    `${orderLabel} is ready for calibration\n\n` +
    `Production order: ${prodid.trim()}\n\n` +
    `-- Sent from the Production Shop Floor app`;

  try {
    await sendMailViaGraph({
      fromMailbox: senderMailbox,
      to: CALIBRATION_TO,
      subject,
      body,
    });
    res.json({ sent: true });
  } catch (err: unknown) {
    if (err instanceof GraphMailError) {
      logger.error({ err: err.message, status: err.status }, "calibration-request failed");
      res.status(502).json({ error: "mail_error", message: err.message });
      return;
    }
    logger.error({ err }, "calibration-request failed");
    res.status(500).json({
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
