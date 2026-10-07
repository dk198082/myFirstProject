import type { Pool } from "pg";

const COORDINATOR_DEFAULT_REGIONS = ["R1", "R2", "R3", "R4", "R5"] as const;

export type CoordinatorDefault = {
  email: string;
  full_name: string | null;
  region_names: string[];
};

export async function getCoordinatorDefault(
  crmPool: Pick<Pool, "query">,
  email: string | undefined,
): Promise<CoordinatorDefault | null> {
  const normalizedEmail = email?.trim();
  if (!normalizedEmail) return null;

  const result = await crmPool.query<{
    email: string | null;
    full_name: string | null;
    region_names: string[] | null;
  }>(
    `
    SELECT
      MIN(NULLIF(BTRIM(su.domainname), '')) AS email,
      MIN(NULLIF(BTRIM(su.fullname), '')) AS full_name,
      ARRAY_AGG(
        DISTINCT UPPER(BTRIM(ter.name))
        ORDER BY UPPER(BTRIM(ter.name))
      ) AS region_names
    FROM crm.territory ter
    JOIN crm.systemuser su
      ON su.systemuserid = ter.managerid
    WHERE LOWER(BTRIM(su.domainname)) = LOWER($1)
      AND UPPER(BTRIM(ter.name)) = ANY($2::text[])
      AND COALESCE(ter.is_deleted, false) = false
      AND COALESCE(su.is_deleted, false) = false
      AND COALESCE(su.isdisabled, false) = false
    HAVING COUNT(*) > 0
    `,
    [normalizedEmail, [...COORDINATOR_DEFAULT_REGIONS]],
  );

  const row = result.rows[0];
  if (!row?.email || !row.region_names?.length) return null;
  return {
    email: row.email,
    full_name: row.full_name,
    region_names: row.region_names,
  };
}