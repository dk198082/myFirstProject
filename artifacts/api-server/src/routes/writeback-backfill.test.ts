import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import request from "supertest";
import type { SessionUser } from "../lib/auth.js";

const mocks = vi.hoisted(() => ({
  crmQuery: vi.fn(),
  isCrmConfigured: vi.fn(() => true),
  isCrmUnavailableError: vi.fn(() => false),
  isDataverseConfigured: vi.fn(() => true),
  fetchWorkOrdersByName: vi.fn(),
  fetchBookingsForWorkOrders: vi.fn(),
}));

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth.js")>();
  return { ...actual };
});

vi.mock("../lib/localDb.js", () => ({
  localPool: { query: vi.fn() },
}));

vi.mock("../lib/crmDb.js", () => ({
  getCrmPool: vi.fn(() => ({ query: mocks.crmQuery })),
  isCrmConfigured: mocks.isCrmConfigured,
  isCrmUnavailableError: mocks.isCrmUnavailableError,
}));

vi.mock("../lib/crmMirror.js", () => ({
  mirrorScheduleBlockUpsert: vi.fn(),
  mirrorScheduleBlockDelete: vi.fn(),
  mirrorPlaceholderJobUpsert: vi.fn(),
  mirrorPlaceholderJobDelete: vi.fn(),
}));

vi.mock("../lib/dataverse.js", () => ({
  isDataverseConfigured: mocks.isDataverseConfigured,
  fetchWorkOrdersByName: mocks.fetchWorkOrdersByName,
  fetchBookingsForWorkOrders: mocks.fetchBookingsForWorkOrders,
  patchBooking: vi.fn(),
  createBooking: vi.fn(),
}));

import writebackRouter from "./writeback.js";

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).log = silentLog;
    next();
  });
  app.get("/__test/seed-editor", (req: Request, res: Response) => {
    req.session.user = {
      entraOid: "oid-editor",
      email: "editor@example.com",
      displayName: "Editor User",
      role: "editor",
    } satisfies SessionUser;
    req.session.save(() => res.json({ ok: true }));
  });
  app.use(writebackRouter);
  return app;
}

describe("POST /wb/admin/backfill-from-dynamics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.crmQuery.mockImplementation(async (query: string) => {
      if (query.includes("SELECT EXISTS")) return { rows: [{ exists: false }] };
      return { rows: [] };
    });
    mocks.fetchWorkOrdersByName.mockResolvedValue([
      {
        msdyn_workorderid: "55c0a624-327c-f111-ab0e-6045bd07264a",
        msdyn_name: "839273",
        msdyn_systemstatus: 690970000,
        msdyn_serviceterritory: "ae1aeb9b-12f7-e511-80de-c4346bac29f8",
        msdyn_serviceaccount: null,
        cf_servicelocation: "8695e98c-f73b-ee11-bdf5-000d3a5bacde",
        msdyn_workordertype: null,
        msdyn_city: "Newbury",
        msdyn_stateorprovince: "BRK",
        new_customerrequirement: null,
        ownerid: null,
        createdon: "2026-08-05T11:04:14Z",
        modifiedon: "2026-08-07T09:49:16Z",
        rawJson: {
          msdyn_name: "839273",
          "_msdyn_serviceterritory_value@OData.Community.Display.V1.FormattedValue": "R4",
          "_cf_servicelocation_value@OData.Community.Display.V1.FormattedValue": "S402310-2",
        },
      },
    ]);
    mocks.fetchBookingsForWorkOrders.mockResolvedValue([]);
  });

  it("upserts the work order and reports missing related mirror rows", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);

    const response = await agent
      .post("/wb/admin/backfill-from-dynamics")
      .send({ woNames: ["839273"] })
      .expect(200);

    expect(response.body).toMatchObject({
      requested: ["839273"],
      work_orders: [
        {
          woName: "839273",
          woId: "55c0a624-327c-f111-ab0e-6045bd07264a",
          status: "upserted",
          missing_dependencies: [
            {
              field: "msdyn_serviceterritory",
              id: "ae1aeb9b-12f7-e511-80de-c4346bac29f8",
              table: "crm.territory",
            },
            {
              field: "cf_servicelocation",
              id: "8695e98c-f73b-ee11-bdf5-000d3a5bacde",
              table: "crm.cf_servicelocation",
            },
          ],
        },
      ],
      bookings: [],
    });

    const insertCall = mocks.crmQuery.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO crm.workorder"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toContain(null);
  });

  it("continues booking backfill when the booking resource or status is absent", async () => {
    mocks.crmQuery.mockImplementation(async (query: string) => {
      if (query.includes("crm.territory")) return { rows: [{ exists: true }] };
      if (query.includes("crm.bookableresource") || query.includes("crm.bookingstatus")) {
        return { rows: [{ exists: false }] };
      }
      return { rows: [] };
    });
    mocks.fetchBookingsForWorkOrders.mockResolvedValue([
      {
        bookableresourcebookingid: "774afc7a-327c-f111-ab0f-6045bd074f44",
        name: "839273 - Newbury",
        starttime: "2026-08-10T08:00:00Z",
        endtime: "2026-08-10T17:00:00Z",
        duration: 540,
        resource: "859dff4d-590c-ee11-8f6e-000d3a323286",
        bookingstatus: "f16d80d1-fd07-4237-8b69-187a11eb75f9",
        msdyn_workorder: "55c0a624-327c-f111-ab0e-6045bd07264a",
        msdyn_actualarrivaltime: null,
        msdyn_actualtravelduration: null,
        msdyn_estimatedtravelduration: null,
        cf_actualarrivaltime: null,
        cf_endtime: null,
        cf_durationschedule: null,
        cf_duration: null,
        cf_fieldnotes: null,
        cf_internalfieldnotes: null,
        createdon: "2026-07-10T07:39:48Z",
        modifiedon: "2026-07-10T07:39:48Z",
        rawJson: {},
      },
    ]);

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);
    const response = await agent
      .post("/wb/admin/backfill-from-dynamics")
      .send({ woNames: ["839273"] })
      .expect(200);

    expect(response.body.bookings).toMatchObject([
      {
        bookingId: "774afc7a-327c-f111-ab0f-6045bd074f44",
        status: "upserted",
        missing_dependencies: [
          { field: "resource", id: "859dff4d-590c-ee11-8f6e-000d3a323286", table: "crm.bookableresource" },
          { field: "bookingstatus", id: "f16d80d1-fd07-4237-8b69-187a11eb75f9", table: "crm.bookingstatus" },
        ],
      },
    ]);
  });
});