# sonner

Source: artifacts/production-priority-board/src/components/ui/sonner.tsx

Provenance: existing, user-provided Production Priority Board workspace source. Copy permission comes from the extraction request; no claim of a separate upstream source-code license. Retained public behavior dependencies keep their own licenses.

Public consumer export: @workspace/production-priority-design-system/components/ui/sonner

Dependencies: none

Imports: next-themes, sonner

Usage evidence (0 unique consumer files):
- Shipped in local component library; no current imports found.

Runtime: Tailwind v4, token-generated global CSS, cn utility; retain source Radix/headless library and React ref/props contract. Source theme: artifacts/production-priority-board/src/index.css. Product-specific state, data, and layouts stay in the app.

Chunk: 11
Status: implemented

## Retained implementation evidence

```tsx
'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

```

Adaptations: package-local relative import rewrites only. Source logic, class strings, public props and behavior dependencies are retained.

Validation: source parity after alias rewrites; story rendered in source-dark and derived-light modes; exported modules and lazy registry entry resolve.
