# aspect-ratio

Source: artifacts/production-priority-board/src/components/ui/aspect-ratio.tsx

Provenance: existing, user-provided Production Priority Board workspace source. Copy permission comes from the extraction request; no claim of a separate upstream source-code license. Retained public behavior dependencies keep their own licenses.

Public consumer export: @workspace/production-priority-design-system/components/ui/aspect-ratio

Dependencies: none

Imports: @radix-ui/react-aspect-ratio

Usage evidence (0 unique consumer files):
- Shipped in local component library; no current imports found.

Runtime: Tailwind v4, token-generated global CSS, cn utility; retain source Radix/headless library and React ref/props contract. Source theme: artifacts/production-priority-board/src/index.css. Product-specific state, data, and layouts stay in the app.

Chunk: 4
Status: implemented

## Retained implementation evidence

```tsx
import * as AspectRatioPrimitive from '@radix-ui/react-aspect-ratio';

const AspectRatio = AspectRatioPrimitive.Root;

export { AspectRatio };

```

Adaptations: package-local relative import rewrites only. Source logic, class strings, public props and behavior dependencies are retained.

Validation: source parity after alias rewrites; story rendered in source-dark and derived-light modes; exported modules and lazy registry entry resolve.
