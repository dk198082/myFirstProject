import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  OPEN_ENDED_BOOKING_MINUTES,
  FS_UTILIZED_MINUTES_SQL,
  FS_BOOKING_NOT_CANCELLED_SQL,
  WB_UTILIZED_MINUTES_SQL,
  WB_BOOKING_NOT_CANCELLED_SQL,
} from "../lib/utilizationSql.js";

// These tests run the EXACT SQL fragments used by the two resource-utilization
// endpoints against a real Postgres so the "open-ended vs. timed job" rule is
// locked in for both:
//   - GET /resource-utilization     (FS db,    FS_*  fragments, `bookings`)
//   - GET /wb/resource-utilization  (d365crm,  WB_*  fragments, `crm.booking`)
//
// Each endpoint LEFT JOINs bookings onto technicians and sums the per-booking
// minutes, excluding cancelled / no-show bookings in the join. We reproduce that
// shape against a session-scoped TEMP table so we exercise the production SQL,
// not a hand-rolled re-implementation that could silently drift.

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── FS endpoint helpers ──────────────────────────────────────────────────────
//
// FS `bookings` exposes time-of-day as TIME columns (crmstarttime / crmendtime)
// plus a stored duration_minutes integer.
type FsBooking = {
  booking_id: string | null;
  crmstarttime: string | null;
  crmendtime: string | null;
  duration_minutes: number | null;
  booking_status: string | null;
};

async function fsUtilizedMinutes(bookings: FsBooking[]): Promise<number> {
  await pool.query(`DROP TABLE IF EXISTS fs_bookings_tmp`);
  await pool.query(
    `CREATE TEMP TABLE fs_bookings_tmp (
       booking_id       text,
       crmstarttime     time,
       crmendtime       time,
       duration_minutes integer,
       booking_status   text
     )`,
  );
  for (const b of bookings) {
    await pool.query(
      `INSERT INTO fs_bookings_tmp
         (booking_id, crmstarttime, crmendtime, duration_minutes, booking_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [b.booking_id, b.crmstarttime, b.crmendtime, b.duration_minutes, b.booking_status],
    );
  }
  const r = await pool.query(
    `SELECT COALESCE(SUM(${FS_UTILIZED_MINUTES_SQL}), 0)::int AS minutes
     FROM fs_bookings_tmp b
     WHERE ${FS_BOOKING_NOT_CANCELLED_SQL}`,
  );
  return r.rows[0].minutes as number;
}

// ── d365crm endpoint helpers ─────────────────────────────────────────────────
//
// crm.booking derives duration from timestamptz columns (starttime / endtime)
// and stores the booking-status name inside raw_json's OData FormattedValue key.
type WbBooking = {
  bookableresourcebookingid: string | null;
  starttime: string | null;
  endtime: string | null;
  status: string | null;
};

function rawJsonFor(status: string | null): string | null {
  if (status === null) return null;
  return JSON.stringify({
    "_bookingstatus_value@OData.Community.Display.V1.FormattedValue": status,
  });
}

async function wbUtilizedMinutes(bookings: WbBooking[]): Promise<number> {
  await pool.query(`DROP TABLE IF EXISTS wb_bookings_tmp`);
  await pool.query(
    `CREATE TEMP TABLE wb_bookings_tmp (
       bookableresourcebookingid text,
       starttime                 timestamptz,
       endtime                   timestamptz,
       raw_json                  jsonb
     )`,
  );
  for (const b of bookings) {
    await pool.query(
      `INSERT INTO wb_bookings_tmp
         (bookableresourcebookingid, starttime, endtime, raw_json)
       VALUES ($1, $2, $3, $4)`,
      [b.bookableresourcebookingid, b.starttime, b.endtime, rawJsonFor(b.status)],
    );
  }
  const r = await pool.query(
    `SELECT COALESCE(SUM(${WB_UTILIZED_MINUTES_SQL}), 0)::int AS minutes
     FROM wb_bookings_tmp b
     WHERE ${WB_BOOKING_NOT_CANCELLED_SQL}`,
  );
  return r.rows[0].minutes as number;
}

// Build a CRM booking from a start time and a duration in minutes so the test
// cases can be expressed in the same "duration" terms as the FS cases.
function wbTimed(id: string, startIso: string, durationMinutes: number, status = "Scheduled"): WbBooking {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return {
    bookableresourcebookingid: id,
    starttime: start.toISOString(),
    endtime: end.toISOString(),
    status,
  };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set to run the utilization SQL tests");
  }
  // Fail fast with a clear message if the local Postgres is unreachable.
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.end();
});

describe("open-ended vs. timed job utilization rule", () => {
  it("counts 480 min (8h) for the shared open-ended constant", () => {
    expect(OPEN_ENDED_BOOKING_MINUTES).toBe(480);
  });

  describe("FS endpoint (/resource-utilization)", () => {
    it("counts a booking missing its start time as a flat 480 min", async () => {
      const minutes = await fsUtilizedMinutes([
        // duration_minutes is intentionally large to prove the open-ended branch
        // wins over the stored duration when a time is missing.
        { booking_id: "1", crmstarttime: null, crmendtime: "17:00", duration_minutes: 600, booking_status: "Scheduled" },
      ]);
      expect(minutes).toBe(480);
    });

    it("counts a booking missing its end time as a flat 480 min", async () => {
      const minutes = await fsUtilizedMinutes([
        { booking_id: "1", crmstarttime: "09:00", crmendtime: null, duration_minutes: 600, booking_status: "Scheduled" },
      ]);
      expect(minutes).toBe(480);
    });

    it("counts a timed booking's real duration rounded to the nearest 30 min", async () => {
      // 95 -> 90 (rounds down), 50 -> 60 (rounds up), 16 -> 30, 14 -> 0.
      expect(
        await fsUtilizedMinutes([
          { booking_id: "1", crmstarttime: "09:00", crmendtime: "10:35", duration_minutes: 95, booking_status: "Scheduled" },
        ]),
      ).toBe(90);
      expect(
        await fsUtilizedMinutes([
          { booking_id: "1", crmstarttime: "09:00", crmendtime: "09:50", duration_minutes: 50, booking_status: "Scheduled" },
        ]),
      ).toBe(60);
      expect(
        await fsUtilizedMinutes([
          { booking_id: "1", crmstarttime: "09:00", crmendtime: "09:16", duration_minutes: 16, booking_status: "Scheduled" },
        ]),
      ).toBe(30);
      expect(
        await fsUtilizedMinutes([
          { booking_id: "1", crmstarttime: "09:00", crmendtime: "09:14", duration_minutes: 14, booking_status: "Scheduled" },
        ]),
      ).toBe(0);
    });

    it("does NOT cap a single long timed booking at 8h", async () => {
      const minutes = await fsUtilizedMinutes([
        { booking_id: "1", crmstarttime: "08:00", crmendtime: "18:00", duration_minutes: 600, booking_status: "Completed" },
      ]);
      expect(minutes).toBe(600);
    });

    it("combines two same-day timed jobs past 8h with no cap", async () => {
      // 300 + 240 = 540 > 480, and neither is capped.
      const minutes = await fsUtilizedMinutes([
        { booking_id: "1", crmstarttime: "08:00", crmendtime: "13:00", duration_minutes: 300, booking_status: "Scheduled" },
        { booking_id: "2", crmstarttime: "13:30", crmendtime: "17:30", duration_minutes: 240, booking_status: "Completed" },
      ]);
      expect(minutes).toBe(540);
    });

    it("excludes cancelled and no-show bookings", async () => {
      const minutes = await fsUtilizedMinutes([
        { booking_id: "1", crmstarttime: "08:00", crmendtime: "12:00", duration_minutes: 240, booking_status: "Completed" },
        { booking_id: "2", crmstarttime: "13:00", crmendtime: "17:00", duration_minutes: 240, booking_status: "Canceled" },
        { booking_id: "3", crmstarttime: null, crmendtime: null, duration_minutes: null, booking_status: "No Show" },
      ]);
      // Only the Completed 240-min job counts; cancelled (open-ended would-be 480)
      // and no-show are dropped.
      expect(minutes).toBe(240);
    });
  });

  describe("d365crm endpoint (/wb/resource-utilization)", () => {
    it("counts a booking missing its start time as a flat 480 min", async () => {
      const minutes = await wbUtilizedMinutes([
        {
          bookableresourcebookingid: "1",
          starttime: null,
          endtime: "2026-06-01T17:00:00Z",
          status: "Scheduled",
        },
      ]);
      expect(minutes).toBe(480);
    });

    it("counts a booking missing its end time as a flat 480 min", async () => {
      const minutes = await wbUtilizedMinutes([
        {
          bookableresourcebookingid: "1",
          starttime: "2026-06-01T09:00:00Z",
          endtime: null,
          status: "Scheduled",
        },
      ]);
      expect(minutes).toBe(480);
    });

    it("counts a timed booking's real duration rounded to the nearest 30 min", async () => {
      expect(await wbUtilizedMinutes([wbTimed("1", "2026-06-01T09:00:00Z", 95)])).toBe(90);
      expect(await wbUtilizedMinutes([wbTimed("1", "2026-06-01T09:00:00Z", 50)])).toBe(60);
      expect(await wbUtilizedMinutes([wbTimed("1", "2026-06-01T09:00:00Z", 16)])).toBe(30);
      expect(await wbUtilizedMinutes([wbTimed("1", "2026-06-01T09:00:00Z", 14)])).toBe(0);
    });

    it("does NOT cap a single long timed booking at 8h", async () => {
      const minutes = await wbUtilizedMinutes([wbTimed("1", "2026-06-01T08:00:00Z", 600, "Completed")]);
      expect(minutes).toBe(600);
    });

    it("combines two same-day timed jobs past 8h with no cap", async () => {
      const minutes = await wbUtilizedMinutes([
        wbTimed("1", "2026-06-01T08:00:00Z", 300, "Scheduled"),
        wbTimed("2", "2026-06-01T13:30:00Z", 240, "Completed"),
      ]);
      expect(minutes).toBe(540);
    });

    it("excludes cancelled and no-show bookings", async () => {
      const minutes = await wbUtilizedMinutes([
        wbTimed("1", "2026-06-01T08:00:00Z", 240, "Completed"),
        wbTimed("2", "2026-06-01T13:00:00Z", 240, "Cancelled"),
        {
          bookableresourcebookingid: "3",
          starttime: null,
          endtime: "2026-06-01T17:00:00Z",
          status: "No Show",
        },
      ]);
      expect(minutes).toBe(240);
    });
  });

  describe("parity between the two endpoints", () => {
    // The same logical bookings must yield the same utilized minutes regardless
    // of which database/endpoint computed them.
    const cases: Array<{ name: string; duration: number; expected: number }> = [
      { name: "short rounds up", duration: 50, expected: 60 },
      { name: "rounds down", duration: 95, expected: 90 },
      { name: "tiny rounds to zero", duration: 14, expected: 0 },
      { name: "long uncapped", duration: 600, expected: 600 },
      // Exact half-boundaries (odd multiples of 15 min). These are where a
      // double round-half-to-even and a numeric round-half-up diverge, so both
      // endpoints must use round-half-up here: 0.5 -> 1, 2.5 -> 3, 4.5 -> 5.
      { name: "half-boundary rounds up", duration: 15, expected: 30 },
      { name: "half-boundary rounds up", duration: 45, expected: 60 },
      { name: "half-boundary rounds up", duration: 75, expected: 90 },
      { name: "half-boundary rounds up", duration: 105, expected: 120 },
      { name: "half-boundary rounds up", duration: 135, expected: 150 },
    ];

    for (const c of cases) {
      it(`agree for a ${c.duration}-min timed job (${c.name})`, async () => {
        const fs = await fsUtilizedMinutes([
          { booking_id: "1", crmstarttime: "09:00", crmendtime: "10:00", duration_minutes: c.duration, booking_status: "Scheduled" },
        ]);
        const wb = await wbUtilizedMinutes([wbTimed("1", "2026-06-01T09:00:00Z", c.duration)]);
        expect(fs).toBe(c.expected);
        expect(wb).toBe(c.expected);
      });
    }
  });
});
