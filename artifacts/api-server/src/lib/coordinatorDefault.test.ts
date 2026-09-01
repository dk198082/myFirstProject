import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { getCoordinatorDefault } from "./coordinatorDefault.js";

const assignments = new Map([
  ["kstrunack@tiniusolsen.com", { email: "KStrunack@tiniusolsen.com", full_name: "Karen Strunack", region_names: ["R1"] }],
  ["amanda.cifaldi@tiniusolsen.com", { email: "Amanda.Cifaldi@tiniusolsen.com", full_name: "Amanda Cifaldi", region_names: ["R2"] }],
  ["iramos@tiniusolsen.com", { email: "IRamos@tiniusolsen.com", full_name: "Ivette Smith", region_names: ["R3"] }],
  ["dwayne.hooper@tiniusolsen.co.uk", { email: "dwayne.hooper@tiniusolsen.co.uk", full_name: "Dwayne Hooper", region_names: ["R4"] }],
  ["edelaney@tiniusolsen.com", { email: "EDelaney@tiniusolsen.com", full_name: "Elyse Delaney", region_names: ["R5"] }],
]);

function createPool() {
  const query = vi.fn(async (_sql: string, values?: unknown[]) => {
    const email = String(values?.[0] ?? "").toLocaleLowerCase();
    const row = assignments.get(email);
    return { rows: row ? [row] : [] };
  });
  return {
    pool: { query } as unknown as Pick<Pool, "query">,
    query,
  };
}

describe("getCoordinatorDefault", () => {
  it.each([
    ["KSTRUNACK@TINIUSOLSEN.COM", "R1"],
    ["Amanda.CIFALDI@tiniusolsen.com", "R2"],
    ["iramos@TINIUSOLSEN.COM", "R3"],
    ["DWAYNE.HOOPER@TINIUSOLSEN.CO.UK", "R4"],
    ["eDelaney@tiniusolsen.com", "R5"],
  ])("resolves %s case-insensitively to %s", async (email, region) => {
    const { pool, query } = createPool();

    const result = await getCoordinatorDefault(pool, email);

    expect(result?.region_names).toEqual([region]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ter.managerid"),
      [email, ["R1", "R2", "R3", "R4", "R5"]],
    );
  });

  it("returns null when the manager or system-user assignment is missing", async () => {
    const { pool } = createPool();
    await expect(getCoordinatorDefault(pool, "unassigned@tiniusolsen.com")).resolves.toBeNull();
  });

  it("keeps non-coordinator users on the all-regions default", async () => {
    const { pool } = createPool();
    await expect(getCoordinatorDefault(pool, "viewer@example.com")).resolves.toBeNull();
  });

  it("does not query CRM without a logged-in email", async () => {
    const { pool, query } = createPool();
    await expect(getCoordinatorDefault(pool, undefined)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});