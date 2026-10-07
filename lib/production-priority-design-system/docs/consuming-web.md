# Consuming Production Priority Board Design System in web apps

Read `artifacts/production-priority-design-system/docs/AGENTS.md` first. This guide covers
React/Vite and other shadcn/Tailwind web consumers. If the app already contains
a local theme or component library, also read
`artifacts/production-priority-design-system/docs/migrating-web.md` before writing UI.

## Theme

Import this package's theme once from the app's main CSS:

```css
@import "@workspace/production-priority-design-system/styles.css";
```

`styles.css` already imports Tailwind, its plugins, and this package's token
theme. It also registers this package's component sources. Do not add a separate
Tailwind import or a `node_modules` source path in a Tailwind v4 consumer.
Tailwind v3 consumers keep their existing `@tailwind` directives and add
`node_modules/@workspace/production-priority-design-system/src/components` to `content`.

## Components and helpers

Import every provided primitive, `cn`, and toast API directly from this package:

```tsx
import { Button } from "@workspace/production-priority-design-system/components/ui/button";
import { cn } from "@workspace/production-priority-design-system/lib/utils";
import {
  toast,
  useToast,
} from "@workspace/production-priority-design-system/hooks/use-toast";
```

Use the package component whenever it provides the required family. Keep
product-specific compositions in the app, but compose them from package
primitives rather than recreating those primitives locally.

The packaged `Toaster` and toast hook share one in-memory store. Do not call a
local toast hook while rendering the packaged `Toaster`.

## Verify

After wiring the workspace dependency, import and render
`@workspace/production-priority-design-system/components/ui/button`. Run the app's typecheck
and dev server. The import must resolve and the Button must use this package's
theme before broader UI work begins.

## Ongoing rules

- Keep one source of theme variables.
- Import package-provided primitives and helpers from the package path.
- Add reusable product-agnostic components to this package first.
- For a non-shadcn app, use the tokens as the source of truth and adapt existing
  components to the token CSS variables without copying token values.

## Catalog and theme modes

All 54 source families are shipped. Toast and the mount-only Toaster share one family. The Sidebar also ships hooks/use-mobile; the Radix toast family ships hooks/use-toast.

The source board is dark-only. Set the document root class to dark to use the extracted source theme. Removing it opts into a derived light palette, not the original board appearance. The source sans and mono utility slots both use the local Aptos, Segoe UI, Arial, sans-serif stack; there are no font binaries or external font requests.

## Providers and notifications

Mount the packaged Toaster once when using the packaged toast hook:

```tsx
import { Toaster } from "@workspace/production-priority-design-system/components/ui/toaster";
import { toast } from "@workspace/production-priority-design-system/hooks/use-toast";

// In the consumer shell: <Toaster />
// In a handler: toast({ title: "Saved", description: "Changes saved." });
```

For the separate Sonner family, use its source provider contract:

```tsx
import { ThemeProvider } from "next-themes";
import { toast } from "sonner";
import { Toaster } from "@workspace/production-priority-design-system/components/ui/sonner";

// Wrap the shell in <ThemeProvider attribute="class" defaultTheme="dark">.
// Mount <Toaster /> inside it; call toast() from sonner, not the Radix hook.
```

Tooltip/TooltipProvider, Sidebar/SidebarProvider, and Form/FormField remain distinct source context contracts. Keep their providers around related children. Calendar uses react-day-picker v9, Chart uses Recharts v2, and Resizable uses react-resizable-panels v2; do not substitute incompatible major versions.

The source dark destructive fill and white text pairing does not meet normal-text AA contrast. For operational warnings, follow the board’s lighter-red text/tinted-fill pattern rather than assuming every retained source pairing is accessible.

## Existing screens

Extraction does not apply the package to the board or to existing canvas frames. Migrate only after explicit application approval. For mockups, read the mockup-sandbox design-system flow and re-home frames to this package’s sandbox entry; do not silently retheme the existing entry.
