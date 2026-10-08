import { formatDecimal } from "./decimal-format";

export const AMOUNT_RE = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

export function validateAmount(v: string, label: string, kind: "amount" | "percentage" = "amount"): string | null {
  const t = v.trim();
  if (!t) return `${label} is required. Enter 0 if none applies.`;
  if (t.startsWith("-")) return `${label} cannot be negative.`;
  if (!AMOUNT_RE.test(t)) return `${label} must be a plain ${kind} with up to 2 decimals, e.g. ${kind === "percentage" ? "7.50" : "125.50"}.`;
  return null;
}

/** Currency display shares the same two-decimal formatting as the PDF. */
export function money(value: string | null | undefined, currency: "USD" | "GBP"): string {
  const formatted = formatDecimal(value);
  if (formatted === "—") return formatted;
  const neg = formatted.startsWith("-");
  const raw = neg ? formatted.slice(1) : formatted;
  const sym = currency === "GBP" ? "£" : "$";
  return `${neg ? "-" : ""}${sym}${raw}`;
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
