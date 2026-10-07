# separator

Source: artifacts/production-priority-board/src/components/ui/separator.tsx

Provenance: existing, user-provided Production Priority Board workspace source. Copy permission comes from the extraction request; no claim of a separate upstream source-code license. Retained public behavior dependencies keep their own licenses.

Public consumer export: @workspace/production-priority-design-system/components/ui/separator

Dependencies: none

Imports: react, @radix-ui/react-separator, @/lib/utils

Usage evidence (4 unique consumer files):
- artifacts/production-priority-board/src/components/ui/button-group.tsx
- artifacts/production-priority-board/src/components/ui/field.tsx
- artifacts/production-priority-board/src/components/ui/item.tsx
- artifacts/production-priority-board/src/components/ui/sidebar.tsx

Runtime: Tailwind v4, token-generated global CSS, cn utility; retain source Radix/headless library and React ref/props contract. Source theme: artifacts/production-priority-board/src/index.css. Product-specific state, data, and layouts stay in the app.

Chunk: 1
Status: implemented

## Retained implementation evidence

```tsx
import * as React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/lib/utils';

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = 'horizontal', decorative = true, ...props },
    ref,
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };

```

Adaptations: only rewrite @/lib/utils to ../../lib/utils; source props, refs, variants, class strings and behavior remain unchanged.

Validation: source parity after alias rewrites; story rendered in source-dark and derived-light modes; exported modules and lazy registry entry resolve.
