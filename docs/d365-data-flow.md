# Data Flow: Replit App ↔ Dynamics 365 Finance & Operations

This document explains, end to end, how data moves between the Replit shop-floor
apps and Dynamics 365 Finance & Operations (D365 F&O) in both directions.

---

## 1. The Big Picture

```
                    READING (D365 → Replit)
┌──────────────┐   export/sync    ┌──────────────────┐   SQL (read-only)   ┌────────────┐   JSON   ┌─────────────┐
│  D365 F&O    │ ───────────────► │ Azure PostgreSQL │ ──────────────────► │ API Server │ ───────► │ Shop Floor  │
│ (toprod...)  │   (staging       │ staging mirror   │                     │ (Replit)   │          │ apps (web / │
│              │    tables)       │ (d365crm DB)     │                     │            │          │ mobile)     │
└──────────────┘                  └──────────────────┘                     └────────────┘          └─────────────┘
       ▲                                                                          │
       │                     WRITING (Replit → D365)                              │
       └──────────────────────── OData REST API (real time) ──────────────────────┘
```

There are **two separate channels**:

| Direction | Channel | Speed |
|---|---|---|
| D365 → Replit (reads) | Azure PostgreSQL staging mirror | Refreshes on a lag (minutes) |
| Replit → D365 (writes) | D365 OData REST API | Real time (seconds) |

---

## 2. Reading Data: D365 → Replit

### How it works

1. **D365 exports its data** into staging tables in an Azure PostgreSQL
   database (`fs-postgresql-prod.postgres.database.azure.com`, database
   `d365crm`). This sync is managed on the D365/Azure side and runs on a
   schedule — the mirror is always slightly behind live D365.
2. **The API server connects to that database read-only**, using the native
   database user (`crmadmin`) with password authentication. It never writes to
   the staging tables.
3. **The apps call the API server** (endpoints like `/api/production-board`,
   `/api/production-groups`, `/api/production-picking`), which runs SQL against
   the staging tables and returns JSON.
4. The Schedule Board polls/refetches on an interval (the "Updated just now"
   indicator), so new D365 data appears automatically once the mirror refreshes.

### Key staging tables used

| Table | What it holds |
|---|---|
| `prodtablestaging` (via board queries) | Production order headers (order id, status, group, qty, pool) |
| `costproductiongroupstaging` | Production groups (id → display name) |
| `ecoresreleasedproductv2staging` | Released products (descriptions, sales classifications) |
| Route / BOM staging tables | Operation hours, picking / remaining material |

### Important characteristic: the lag

Because the mirror refreshes on a schedule, **a change made in D365 right now
will not appear in the Replit apps until the next sync**. This is fine for
viewing, but it creates a problem for edits made *from* the Replit app — solved
by the overlay mechanism described in section 4.

### Important characteristic: partial export rows

Each BYOD export job appends a fresh row to the staging header table rather
than updating existing rows. Crucially, **different export jobs may carry
different subsets of fields**: a job triggered by a status change may export a
row where `productiongroupid` is blank, even though an earlier export row for
the same order carried the correct group.

Naively picking the single most-recent row per order (by `tomodifieddatetime`)
can silently discard the group value: the newest row wins the `DISTINCT ON`
deduplication but carries an empty group, so the order appears in the wrong
group or vanishes from the board entirely.

The board query defends against this with a second CTE (`latest_group`) that
independently selects the most-recent **non-empty** `productiongroupid` across
all rows for each order, then coalesces it over the newest-row value. This
means the board always shows the last explicitly-set group regardless of
whether the very latest export row happened to include it.

---

## 3. Writing Data: Replit → D365 (Real Time)

When a user changes an order's production group on the Schedule Board:

### Step-by-step

1. **User clicks the pencil icon** on an order card and picks a new production
   group from the dialog (the list comes from `costproductiongroupstaging`).
2. **The app calls the API server**:
   `PATCH /api/production-orders/{orderId}/production-group` with the new
   group id.
3. **The API server validates** the group id against
   `costproductiongroupstaging` — unknown groups are rejected immediately
   (HTTP 400) without touching D365.
4. **The API server authenticates to D365** using Azure AD
   *client-credential flow*:
   - Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - Token scope: `https://toprod.operations.dynamics.com/.default`
   - Tokens are cached (~60 min) and refreshed automatically.
5. **The API server writes to D365 via OData**:

   ```
   PATCH https://toprod.operations.dynamics.com/data/TO_SOProdTable(dataAreaId='TOUS',ProdId='336848')?cross-company=true
   Authorization: Bearer <token>
   If-Match: *

   { "ProdGroupId": "Assy03" }
   ```

   - `TO_SOProdTable` is the custom data entity backed directly by D365's
     `ProdTable`. It is used instead of the standard `ProductionOrderHeaders`
     entity because the standard entity only allows updates on orders with
     status **Created** — while nearly every order on the board is **Started**.
     `TO_SOProdTable` permits group changes on Started orders (only **Ended**
     orders are blocked).
   - `cross-company=true` is required because the same order number can exist
     in multiple companies (e.g. TOUS and TOUK) — the company is always pinned
     explicitly to `TOUS`.
6. **D365 validates and applies the change instantly** (returns HTTP 204).
   The change is live in D365 the moment the call succeeds — visible to any
   D365 user immediately.
7. **Only after D365 accepts** does the API server store a local *override*
   (see next section), then returns success to the app, which shows a
   confirmation toast and refreshes the board.

### If anything fails

| Failure | What happens |
|---|---|
| Unknown group id | HTTP 400, nothing written anywhere |
| D365 rejects the change (validation, permissions) | HTTP 502 with D365's reason; **no local override is stored** — the app never pretends a failed write succeeded |
| Azure AD credentials invalid | HTTP 502 with guidance |
| App not registered in D365 | HTTP 502 explaining the registration step (System administration → Setup → Microsoft Entra ID applications) |

---

## 4. Bridging the Gap: the Override Overlay

**The problem:** the write goes to D365 in real time, but reads come from the
staging mirror, which lags. Without help, the user would change a group, see
"success," and then watch the board snap back to the *old* group until the next
mirror sync.

**The solution:** a small local table, `production_group_overrides`, in the
Replit app's own database:

1. After a successful D365 write, the API server stores
   `(orderId → newGroupId)` in this table.
2. Every time the board is read, the API server **overlays** these overrides on
   top of the staging data — so the board shows the new group immediately.
3. On each read it also checks: *has the staging mirror caught up?* If the
   mirror now shows the new group, the override row is **deleted
   automatically** — D365 (via the mirror) becomes the source of truth again.

This means:

- The user sees their change instantly.
- D365 remains the single source of truth — the override is a temporary bridge,
  never a fork.
- If someone later changes the group *in D365 itself*, that change flows to the
  board through the normal mirror sync (no stale override can mask it, because
  overrides self-delete as soon as staging matches).

---

## 5. Authentication Summary

| Connection | Method | Credentials |
|---|---|---|
| API server → Azure PG mirror (reads) | Native password auth | `AZURE_PG_USER` (crmadmin) + `PG_NATIVE_PASSWORD` / `AZURE_PG_PASSWORD` |
| API server → D365 OData (writes) | Azure AD client-credential (OAuth 2.0) | `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` |

Two requirements for D365 writes to work:

1. The Azure app registration exists in Microsoft Entra ID (provides the token).
2. The same app is registered **inside D365** under
   *System administration → Setup → Microsoft Entra ID applications*, mapped to
   a D365 user with permission to update production orders. A valid Azure AD
   token alone is not enough — without this step D365 returns 401/403.

All credentials are stored as Replit Secrets — never in code.

---

## 6. Full Round Trip Example

Changing order **336848** from *GenAssy* to *Assy03*:

| Time | What happens | Where |
|---|---|---|
| 0s | User picks *Assy03* in the dialog, clicks save | Shop Floor app |
| ~0.1s | API validates *Assy03* exists | Azure PG mirror |
| ~1–3s | OData PATCH sent, D365 applies it (204) | D365 F&O — **change is live in D365** |
| ~3s | Override stored, success toast, board refetch — card shows *Assy03* | Replit |
| minutes later | Staging mirror syncs, now also shows *Assy03* | Azure PG |
| next board read | API sees mirror matches → deletes the override | Replit |
| after that | Board reads *Assy03* straight from the mirror; no overlay involved | steady state |

---

## 7. What This Design Guarantees

- **No phantom updates** — an override (and success message) exists only if
  D365 actually accepted the write.
- **No stale UI** — successful changes appear on the board immediately, not
  after the mirror sync.
- **D365 stays authoritative** — overrides self-destruct as soon as the mirror
  catches up; changes made directly in D365 always flow through.
- **Explicit failures** — every failure mode returns a clear error to the user;
  nothing fails silently.
- **Read-only mirror** — the Replit app never writes to the staging database;
  all writes go through D365's own validated OData API, so D365 business rules
  are always enforced.
