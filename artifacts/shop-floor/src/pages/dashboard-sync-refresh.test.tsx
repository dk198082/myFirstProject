import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSyncTriggeredRefresh } from "./dashboard";

afterEach(cleanup);

type SyncStatus = { lastsync?: string | null; overlaylastupdated?: string | null } | undefined;

function Harness({ syncStatus, probedAt }: { syncStatus: SyncStatus; probedAt: number }) {
  useSyncTriggeredRefresh(syncStatus, probedAt);
  return null;
}

// Each call to probe() simulates one completed poll of the sync-status
// endpoint: probedAt increments every time (mirroring react-query's
// dataUpdatedAt), even when the payload value is unchanged.
function setup(initial: SyncStatus) {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  let probedAt = initial === undefined ? 0 : 1;
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Harness syncStatus={initial} probedAt={probedAt} />
    </QueryClientProvider>,
  );
  const probe = (next: SyncStatus) => {
    probedAt += 1;
    result.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness syncStatus={next} probedAt={probedAt} />
      </QueryClientProvider>,
    );
  };
  return { invalidateSpy, probe };
}

const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);

const T0 = "2026-07-28T06:00:00Z";
const T1 = "2026-07-28T07:00:00Z";
const T1b = "2026-07-28T07:02:30Z"; // same batch run, still landing
const T2 = "2026-07-28T09:00:00Z";
const O1 = "2026-07-28T08:00:00Z"; // overlay timestamp

describe("useSyncTriggeredRefresh (settle window)", () => {
  test("first sync-status result seeds the baseline without refetching", () => {
    const { invalidateSpy, probe } = setup(undefined);
    expect(invalidateSpy).not.toHaveBeenCalled();
    probe({ lastsync: T0 });
    expect(invalidateSpy).not.toHaveBeenCalled();
    // Even a steady follow-up probe on the baseline stays quiet.
    probe({ lastsync: T0 });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test("an advancing lastsync does NOT refresh immediately (export mid-flight)", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0 });
    probe({ lastsync: T1 });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test("refresh fires once the lastsync holds steady for a second probe", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0 });
    probe({ lastsync: T1 }); // advance — pending, no refresh
    probe({ lastsync: T1 }); // steady — settled, fire once
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidatedKeys(invalidateSpy)).toEqual([
      "/api/production-board",
      "/api/production-utilization",
      "/api/production-picking",
    ]);
  });

  test("a multi-minute batch run produces exactly ONE refresh", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0 });
    // Export lands over several probes: timestamp keeps advancing.
    probe({ lastsync: T1 });
    probe({ lastsync: T1b });
    expect(invalidateSpy).not.toHaveBeenCalled();
    // Export finished: timestamp holds — one refresh, not two.
    probe({ lastsync: T1b });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    // Continued steady probes stay quiet.
    probe({ lastsync: T1b });
    probe({ lastsync: T1b });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  test("an unchanged timestamp triggers nothing (no refetch storm)", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0 });
    probe({ lastsync: T0 });
    probe({ lastsync: T0 });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test("each settled batch run fires again", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0 });
    probe({ lastsync: T1 });
    probe({ lastsync: T1 });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    // Next batch run: advance then settle → fires again.
    probe({ lastsync: T2 });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    probe({ lastsync: T2 });
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
  });

  test("a timestamp regression does NOT trigger a refresh", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T1 });
    // Sync status rolls back (replica lag / clock skew) and holds there.
    probe({ lastsync: T0 });
    probe({ lastsync: T0 });
    probe({ lastsync: T0 });
    expect(invalidateSpy).not.toHaveBeenCalled();
    // A genuine forward advance afterwards still works.
    probe({ lastsync: T2 });
    probe({ lastsync: T2 });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  test("a failed probe mid-settle doesn't lose the pending refresh", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0 });
    probe({ lastsync: T1 }); // advance — pending
    probe(undefined); // probe failure / no data — ignored
    expect(invalidateSpy).not.toHaveBeenCalled();
    probe({ lastsync: T1 }); // recovered, timestamp settled — fire once
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  test("a null lastsync baseline still triggers once a real timestamp settles", () => {
    const { invalidateSpy, probe } = setup({ lastsync: null });
    probe({ lastsync: T0 });
    expect(invalidateSpy).not.toHaveBeenCalled();
    probe({ lastsync: T0 });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  // ── overlaylastupdated tests ─────────────────────────────────────────────
  // Unlike lastsync (which uses a settle window for multi-minute D365 batch
  // exports), overlaylastupdated fires IMMEDIATELY on the first probe that
  // shows an advance. Overlay writes are atomic single-row upserts, not
  // multi-minute batches, so the settle window would only add unnecessary
  // latency (up to one extra 60s probe cycle).

  test("a new overlaylastupdated fires a refresh immediately on the first probe", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0, overlaylastupdated: null });
    probe({ lastsync: T0, overlaylastupdated: O1 }); // advance — fires immediately
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidatedKeys(invalidateSpy)).toEqual([
      "/api/production-board",
      "/api/production-utilization",
      "/api/production-picking",
    ]);
    // Steady follow-up stays quiet — no double-fire.
    probe({ lastsync: T0, overlaylastupdated: O1 });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  test("unchanged overlay and unchanged lastsync stay quiet", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0, overlaylastupdated: O1 });
    probe({ lastsync: T0, overlaylastupdated: O1 });
    probe({ lastsync: T0, overlaylastupdated: O1 });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test("overlay fires immediately; lastsync additionally fires after settling", () => {
    // Both advance on the same probe cycle.
    const { invalidateSpy, probe } = setup({ lastsync: T0, overlaylastupdated: null });
    probe({ lastsync: T1, overlaylastupdated: O1 });
    // Overlay fires immediately (3 calls). Lastsync sets pending and returns.
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    probe({ lastsync: T1, overlaylastupdated: O1 });
    // Lastsync settled — fires 3 more times.
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
  });

  test("each subsequent overlay advance fires immediately on its first probe", () => {
    const { invalidateSpy, probe } = setup({ lastsync: T0, overlaylastupdated: null });
    probe({ lastsync: T0, overlaylastupdated: O1 });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    probe({ lastsync: T0, overlaylastupdated: T2 }); // second overlay advance
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
  });
});
