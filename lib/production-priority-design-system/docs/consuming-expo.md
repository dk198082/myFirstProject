# Consuming portable tokens in Expo

Read docs/AGENTS.md first. This extraction ships the source’s web component library, not native components or native theme/font hooks. Do not import the DOM/Radix components into React Native.

The shipped cross-platform export is the portable token object:

```tsx
import { tokens } from "@workspace/production-priority-design-system/tokens";
const colors = tokens.color.dark;
const radius = Number.parseFloat(tokens.radius) * 16;
const spacing = Number.parseFloat(tokens.spacing) * 16;
```

The current radius and spacing values use rem units. Map semantic colors to native controls and convert lengths once in a native adapter. If you explicitly add a native adapter in future work, keep it in this package and document its actual exports here; no such adapter is currently shipped.

The source system-font stack is not a set of bundled font files. Aptos/Segoe UI availability differs across devices; a native renderer must use an available system font or properly licensed font files. Do not pretend that a font-loading hook exists or substitute a downloaded font silently.

Dark is source-mapped; light is derived. Any native application is separate work and requires its own implementation and verification.
