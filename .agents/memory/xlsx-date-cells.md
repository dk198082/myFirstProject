---
name: SheetJS xlsx date cells
description: How to write real Excel date cells with the xlsx (SheetJS) 0.18.5 package used in the frontend.
---

# Writing real date cells with `xlsx` (SheetJS)

`XLSX.utils.json_to_sheet([{ d: new Date(...) }], { cellDates: true })` does
NOT produce a usable date cell in this version — it stores a **bare `Date`**
as the cell (no `{t:'d', v, z}` wrapper), which is silently **dropped on
`XLSX.write`** (the cell comes back MISSING after a write→read roundtrip). So
passing Date objects through json_to_sheet gives you either text or empty cells.

**Rule:** build the sheet from an array-of-arrays (`aoa_to_sheet`) with the date
columns left as `null` placeholders, then overwrite each date cell explicitly:

```ts
const addr = XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx }); // +1 for header row
ws[addr] = { t: "d", v: parseISO(iso), z: "ddd dd-mmm-yy" };
```

These explicit `t:"d"` cells survive the write→read roundtrip (come back
`t=d`, `w="Thu 07-May-26"`) and Excel treats them as real dates (sortable /
filterable / re-formattable), not text.

**Why:** the New Booking / Schedule export needed dates as a date data type in
Excel, not text. First attempt (pretty strings) = text; second attempt (Date via
json_to_sheet) = dropped/missing. Explicit cells are the only reliable path.

**How to apply:** any xlsx export in this repo that needs date-typed columns must
set cells explicitly as `{t:"d", v: Date, z: fmt}` — do not rely on json_to_sheet
+ cellDates. SheetJS serializes via local date getters, so `parseISO` (local
midnight) yields the correct day regardless of timezone.
