---
name: Shop-floor theming
description: How the shop-floor desktop + mobile apps are themed, and the gotcha when changing the palette.
---
Both `artifacts/shop-floor` and `artifacts/shop-floor-mobile` are Tailwind v4 and
almost entirely token-driven: the whole palette lives in the `:root` CSS variables
in each app's `src/index.css` (`--background`, `--foreground`, `--card`, `--border`,
`--primary`, `--muted-foreground`, plus rgba helpers `--elevate-1/2`,
`--button-outline`, `--badge-outline`, and `--opaque-button-border-intensity`).
`.dark` is empty and there is no dark-class toggling — `:root` IS the active theme.

**Readability:** `--muted-foreground` is the dark-slate secondary-text color (currently `215 25% 27%`); keep it dark (≤~30% L) so card detail text stays legible, and avoid stacking low `/50–/70` opacity on small muted text.

**Rule:** to retheme, flip the `:root` tokens in BOTH apps' `index.css` identically.
For a light theme, `--opaque-button-border-intensity` must be negative (it feeds
`calc(l + var(...))` to derive button borders; positive lightens, negative darkens),
and the rgba helpers should be slate-based `rgba(15,23,42,...)` not white-based.

**Why / gotcha:** the token flip covers ~99% of surfaces, BUT a handful of pages
hardcode accent colors as `text-*-300` / `text-*-400` (status text, on-time/late,
continuity %, unscheduled warnings, model-group labels) and dark-theme status-badge
maps (`bg-*-500/20 text-*-300`). These are invisible/low-contrast on white. After any
light retheme, grep for `text-(red|green|amber|orange|blue|rose|violet|teal|cyan|pink|lime|...)-(300|400)`
in `*/src/pages` and darken to `-700`. Leave `bg-black/*` modal overlays and the
toast destructive variant (`text-red-300` on red bg) alone.
