# toggle-group

Source: artifacts/production-priority-board/src/components/ui/toggle-group.tsx

Provenance: existing, user-provided Production Priority Board workspace source. Copy permission comes from the extraction request; no claim of a separate upstream source-code license. Retained public behavior dependencies keep their own licenses.

Public consumer export: @workspace/production-priority-design-system/components/ui/toggle-group

Dependencies: toggle

Imports: react, @radix-ui/react-toggle-group, @/components/ui/toggle, @/lib/utils, class-variance-authority

Usage evidence (0 unique consumer files):
- Shipped in local component library; no current imports found.

Runtime: Tailwind v4, token-generated global CSS, cn utility; retain source Radix/headless library and React ref/props contract. Source theme: artifacts/production-priority-board/src/index.css. Product-specific state, data, and layouts stay in the app.

Chunk: 11
Status: implemented

## Retained implementation evidence

```tsx
'use client';

import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { type VariantProps } from 'class-variance-authority';

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: 'default',
  variant: 'default',
});

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn('flex items-center justify-center gap-1', className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleVariants>
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };

```

Adaptations: package-local relative import rewrites only. Source logic, class strings, public props and behavior dependencies are retained.

Validation: source parity after alias rewrites; story rendered in source-dark and derived-light modes; exported modules and lazy registry entry resolve.
