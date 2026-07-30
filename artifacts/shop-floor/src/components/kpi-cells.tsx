import type { Verdict } from "@/lib/kpi";

export function VerdictBadge({ v }: { v: Verdict }) {
  if (v == null) return <span className="text-muted-foreground/40">—</span>;
  const onTime = v === "ON TIME";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        onTime
          ? "bg-green-500/15 text-green-700 border border-green-500/30"
          : "bg-red-500/15 text-red-700 border border-red-500/30"
      }`}
    >
      {v}
    </span>
  );
}

export function ContinuityCell({ value }: { value: number }) {
  const color =
    value >= 80 ? "text-green-700" : value >= 50 ? "text-amber-700" : "text-red-700";
  return <span className={`font-semibold ${color}`}>{Math.round(value)}%</span>;
}
