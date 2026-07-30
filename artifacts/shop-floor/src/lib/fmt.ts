export function fmtHours(val: number | null | undefined): string {
  if (val == null || val === 0) return "—";
  const totalMinutes = Math.round(val * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
