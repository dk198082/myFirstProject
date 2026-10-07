/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f5f8f5",
      "foreground": "#00291e",
      "border": "#c2d2c7",
      "card": "#ffffff",
      "cardForeground": "#00291e",
      "popover": "#ffffff",
      "popoverForeground": "#00291e",
      "primary": "#315700",
      "primaryForeground": "#ffffff",
      "secondary": "#e8f0eb",
      "secondaryForeground": "#244336",
      "muted": "#edf2ee",
      "mutedForeground": "#506759",
      "accent": "#e2efdb",
      "accentForeground": "#173b28",
      "destructive": "#b91c1c",
      "destructiveForeground": "#ffffff",
      "input": "#9ab3a3",
      "ring": "#315700",
      "chart1": "#568000",
      "chart2": "#0369a1",
      "chart3": "#b91c1c",
      "chart4": "#9b6500",
      "chart5": "#c33a45",
      "sidebar": "#edf2ee",
      "sidebarForeground": "#00291e",
      "sidebarBorder": "#c2d2c7",
      "sidebarPrimary": "#315700",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#e2efdb",
      "sidebarAccentForeground": "#173b28",
      "sidebarRing": "#315700",
      "warning": "#ffd48a",
      "warningForeground": "#00291e"
    },
    "dark": {
      "background": "#00291e",
      "foreground": "#ffffff",
      "border": "#13392f",
      "card": "#052e23",
      "cardForeground": "#ffffff",
      "popover": "#052e23",
      "popoverForeground": "#ffffff",
      "primary": "#b7ff00",
      "primaryForeground": "#00291e",
      "secondary": "#13392f",
      "secondaryForeground": "#c2d0be",
      "muted": "#0f2e26",
      "mutedForeground": "#c2d0be",
      "accent": "#174539",
      "accentForeground": "#ffffff",
      "destructive": "#ff3333",
      "destructiveForeground": "#ffffff",
      "input": "#13392f",
      "ring": "#b7ff00",
      "chart1": "#b7ff00",
      "chart2": "#7dd3fc",
      "chart3": "#fca5a5",
      "chart4": "#fcd34d",
      "chart5": "#f87171",
      "sidebar": "#00291e",
      "sidebarForeground": "#ffffff",
      "sidebarBorder": "#13392f",
      "sidebarPrimary": "#b7ff00",
      "sidebarPrimaryForeground": "#00291e",
      "sidebarAccent": "#174539",
      "sidebarAccentForeground": "#ffffff",
      "sidebarRing": "#b7ff00",
      "warning": "#ff9500",
      "warningForeground": "#00291e"
    }
  },
  "fontFamily": {
    "sans": [
      "Aptos",
      "Segoe UI",
      "Arial",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "Aptos",
      "Segoe UI",
      "Arial",
      "sans-serif"
    ]
  },
  "radius": "0.125rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
