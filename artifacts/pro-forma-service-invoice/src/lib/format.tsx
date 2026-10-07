export const AMOUNT_RE = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

export function validateAmount(v: string, label: string): string | null {
  const t = v.trim();
  if (!t) return `${label} is required. Enter 0 if none applies.`;
  if (t.startsWith("-")) return `${label} cannot be negative.`;
  if (!AMOUNT_RE.test(t)) return `${label} must be a plain amount with up to 2 decimals, e.g. 125.50.`;
  return null;
}

/** Group digits of an exact decimal string without converting to float. */
export function money(value: string | null | undefined, currency: "USD" | "GBP"): string {
  if (value == null || value === "") return "—";
  const neg = value.startsWith("-");
  const raw = neg ? value.slice(1) : value;
  const [int, frac = ""] = raw.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sym = currency === "GBP" ? "£" : "$";
  return `${neg ? "-" : ""}${sym}${grouped}${frac ? "." + frac : ""}`;
}

export function humanize(key: string): string {
  return key
    .replace(/^(cf_|crm_|new_)/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export type HeaderGroup = { id: string; title: string; entries: [string, string][] };

const GROUPS: { id: string; title: string; re: RegExp }[] = [
  { id: "remit", title: "Company and remittance", re: /^company_|^remit_to$/i },
  { id: "bill", title: "Bill to", re: /^account_|bill|invoice(to|account|address)|customer/i },
  { id: "deliver", title: "Delivery address", re: /deliver|ship|site|servicelocation/i },
  { id: "contact", title: "Contacts", re: /contact|phone|email|fax|attention/i },
  { id: "ref", title: "References", re: /order|number|ref|po|quote|proposal|workorder|account|date|region|currency|terms/i },
];

export function groupHeader(header: Record<string, string | null>): { groups: HeaderGroup[]; empty: string[] } {
  const buckets = new Map<string, [string, string][]>();
  const other: [string, string][] = [];
  const empty: string[] = [];
  for (const [k, v] of Object.entries(header)) {
    if (v == null || String(v).trim() === "") {
      empty.push(k);
      continue;
    }
    const g = GROUPS.find((g) => g.re.test(k));
    if (g) buckets.set(g.id, [...(buckets.get(g.id) ?? []), [k, String(v)]]);
    else other.push([k, String(v)]);
  }
  const groups: HeaderGroup[] = GROUPS.filter((g) => buckets.has(g.id)).map((g) => ({
    id: g.id,
    title: g.title,
    entries: buckets.get(g.id)!,
  }));
  if (other.length) groups.push({ id: "other", title: "Other header fields", entries: other });
  return { groups, empty };
}
