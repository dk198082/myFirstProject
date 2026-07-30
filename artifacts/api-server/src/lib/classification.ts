// Model-tab classification for production orders.
//
// An order is sorted onto the booking board by its released product's Sales
// Classifications: Sales Classification 2 must match the tab's allowed
// category (most tabs require 'Machine'; the MFI tab also accepts 'MFI'), and
// Sales Classification 3 must match one of the model-tab buckets below.
// Anything else is unassigned (null) and filtered out of the board.
//
// `classifyTab` (pure JS) and `buildTabCaseSql` (the SQL CASE used in queries)
// are both derived from TAB_RULES so they cannot drift apart.

export const TABS = [
  "300SL",
  "600SL",
  "1000/2000SL",
  "MetalsImpact",
  "MFI",
] as const;
export type Tab = (typeof TABS)[number];

const MACHINE = "Machine";

const TAB_RULES: {
  tab: Tab;
  class2: readonly string[];
  class3: readonly string[];
}[] = [
  { tab: "300SL", class2: [MACHINE], class3: ["300SL"] },
  { tab: "600SL", class2: [MACHINE], class3: ["600SL"] },
  { tab: "1000/2000SL", class2: [MACHINE], class3: ["1000SL", "2000SL"] },
  { tab: "MetalsImpact", class2: [MACHINE], class3: ["IT406", "IT542"] },
  {
    tab: "MFI",
    class2: [MACHINE],
    class3: ["MP1200", "MP1200MAN", "MP1200MWLD", "MP1500"],
  },
];

/**
 * Map a released product's sales classifications to its model tab, or null when
 * the product is not an assignable machine for any known tab.
 */
export function classifyTab(
  salesClassification2: string | null | undefined,
  salesClassification3: string | null | undefined,
): Tab | null {
  if (salesClassification2 == null) return null;
  if (salesClassification3 == null) return null;
  for (const rule of TAB_RULES) {
    if (
      rule.class2.includes(salesClassification2) &&
      rule.class3.includes(salesClassification3)
    ) {
      return rule.tab;
    }
  }
  return null;
}

/** Type guard for a known model tab. */
export function isTab(val: unknown): val is Tab {
  return typeof val === "string" && (TABS as readonly string[]).includes(val);
}

function quote(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

/**
 * Build the SQL CASE expression that mirrors {@link classifyTab}, using the
 * given column references for sales classification 2 and 3. Resolves to NULL
 * for unassigned products.
 */
export function buildTabCaseSql(class2Col: string, class3Col: string): string {
  const whens = TAB_RULES.map((rule) => {
    const c2List = rule.class2.map(quote).join(", ");
    const c3List = rule.class3.map(quote).join(", ");
    return `    WHEN ${class2Col} IN (${c2List}) AND ${class3Col} IN (${c3List}) THEN ${quote(rule.tab)}`;
  });
  return `\n  CASE\n${whens.join("\n")}\n    ELSE NULL\n  END\n`;
}
