# textarea

Source: artifacts/production-priority-board/src/components/ui/textarea.tsx

Provenance: existing, user-provided Production Priority Board workspace source. Copy permission comes from the extraction request; no claim of a separate upstream source-code license. Retained public behavior dependencies keep their own licenses.

Public consumer export: @workspace/production-priority-design-system/components/ui/textarea

Dependencies: none

Imports: react, @/lib/utils

Usage evidence (1 unique consumer files):
- artifacts/production-priority-board/src/components/ui/input-group.tsx

Runtime: Tailwind v4, token-generated global CSS, cn utility; retain source Radix/headless library and React ref/props contract. Source theme: artifacts/production-priority-board/src/index.css. Product-specific state, data, and layouts stay in the app.

Chunk: 3
Status: implemented

## Retained implementation evidence

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };

```

Adaptations: package-local relative import rewrites only. Source logic, class strings, public props and behavior dependencies are retained.

Validation: source parity after alias rewrites; story rendered in source-dark and derived-light modes; exported modules and lazy registry entry resolve.
