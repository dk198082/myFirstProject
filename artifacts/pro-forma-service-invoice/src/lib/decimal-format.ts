/** Display exact decimal strings to two places, using half-up rounding. */
export function formatDecimal(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("Invalid decimal value.");
  const [, sign, whole, fraction = ""] = match;
  let hundredths = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (fraction.length > 2 && fraction[2] >= "5") hundredths += 1n;
  const integer = (hundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = (hundredths % 100n).toString().padStart(2, "0");
  return `${sign && hundredths !== 0n ? "-" : ""}${integer}.${decimals}`;
}
