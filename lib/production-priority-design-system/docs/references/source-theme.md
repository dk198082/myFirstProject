# Source theme

Subject: board visual foundations. Kind: app-ui/code. Source: artifacts/production-priority-board/src/index.css.

Actual HSL declarations are authoritative; illustrative hex comments are not always identical. Literal board backgrounds in Dashboard and ProductionGantt also include #00281D, #07392b and #033024; these are composition-level tint choices rather than new core roles.

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@plugin "@tailwindcss/typography";

.date-filter-input::-webkit-calendar-picker-indicator {
  filter: brightness(0) invert(1);
  opacity: 0.9;
}

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-card-border: hsl(var(--card-border));

  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-popover-border: hsl(var(--popover-border));

  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-primary-border: var(--primary-border);

  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-secondary-border: var(--secondary-border);

  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-muted-border: var(--muted-border);

  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-accent-border: var(--accent-border);

  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-destructive-border: var(--destructive-border);

  --color-warning: hsl(var(--warning));
  --color-warning-foreground: hsl(var(--warning-foreground));
  --color-warning-border: var(--warning-border);

  --font-sans: var(--app-font-sans);
  --font-serif: var(--app-font-serif);
  --font-mono: var(--app-font-mono);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root, .dark {
  /* Enforce Dark Mode Colors strictly based on the prompt */
  --background: 164 100% 8%; /* #00281D */
  --foreground: 0 0% 100%; /* #FFFFFF */
  
  --border: 164 50% 15%; 
  --input: 164 50% 15%;
  --ring: 77 100% 50%; /* #B7FF00 */

  --card: 164 80% 10%; 
  --card-foreground: 0 0% 100%;
  --card-border: 164 50% 15%;

  --popover: 164 80% 10%;
  --popover-foreground: 0 0% 100%;
  --popover-border: 164 50% 15%;

  --primary: 77 100% 50%; /* #B7FF00 */
  --primary-foreground: 164 100% 8%; /* Dark text on primary accent */

  --secondary: 164 50% 15%;
  --secondary-foreground: 108 16% 78%; /* #C2D2BE */

  --muted: 164 50% 12%;
  --muted-foreground: 108 16% 78%; /* #C2D2BE */

  --accent: 164 50% 18%;
  --accent-foreground: 0 0% 100%;

  --destructive: 0 100% 60%; /* #FF3333 */
  --destructive-foreground: 0 0% 100%;
  
  --warning: 35 100% 50%; /* Amber #FFB000 */
  --warning-foreground: 164 100% 8%;

  --app-font-sans: Aptos, 'Segoe UI', Arial, sans-serif;
  --app-font-mono: Aptos, 'Segoe UI', Arial, sans-serif;
  
  --radius: 0.125rem; /* sharper corners for technical feel */

  /* Used in utility classes */
  --elevate-1: rgba(255, 255, 255, 0.05);
  --elevate-2: rgba(255, 255, 255, 0.1);
  --button-outline: rgba(255, 255, 255, 0.1);
  --badge-outline: rgba(255, 255, 255, 0.05);
  --opaque-button-border-intensity: 9;
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply font-sans antialiased bg-background text-foreground;
  }
  
  /* Scrollbar styling for cockpit feel */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.5);
  }
}

@layer utilities {
  .text-shadow-sm {
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
}
```
