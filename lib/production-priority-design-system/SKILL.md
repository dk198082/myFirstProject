---
name: Production Priority Board visual language
description: Source-backed rules for the board's palette, typography, dense layouts and reusable components.
---

# Source and status

Extracted from the existing Production Priority Board's CSS and reusable local UI library. This package is independent; extraction does not change the app.

All 54 source families are extracted, each with a registered story, source references and retained source implementation. Toast also ships the mount-only Toaster, and source toast/mobile hooks are included. See docs/references/component-inventory.md. Approval to finish extraction is not permission to apply the package to existing screens.

## Source-derived visual rules

- Dark green is the default page and operational surface background. Lime emphasizes priority numbers, active filters, active tabs and primary actions.
- Keep information hierarchy compact: uppercase 9–10px field labels with letter spacing, bold 12–14px part/work-order identifiers, and 20px KPI quantities.
- Use the same local Aptos, Segoe UI, Arial, sans-serif font stack for the source's sans and mono utility slots. "Mono" is a source utility name, not evidence of a separate monospaced font.
- The source defines a 4px spacing step and a 2px base radius. Preserve shared component variant APIs and their radius utility classes; badge pills are an intentional exception to sharp-corner panels.
- Operational statuses use color together with readable labels. Overdue indicators use red; incomplete or reversed schedules use amber; ship dates use light-blue diamonds. Do not rely on color alone.
- Dense tables and timelines scroll inside their own bounded containers. Gantt rows are 38px high and order labels remain fixed while scrolling.
- Separate regions with thin green borders and subtle tinted surfaces. Active source controls may use a small lime glow; don't add heavy decoration to the data grid.

These rules come from artifacts/production-priority-board/src/index.css, src/pages/Dashboard.tsx and src/components/ProductionGantt.tsx. There was no separate brand manual or genuine logo asset to import.

## Theme and font limitations

- Source dark is extracted from actual HSL declarations, not approximate hex comments. The source also has composition-specific green literals, retained in source-theme.md.
- Light is a derived companion palette, not a source mode. The preview clearly labels it as derived and uses darker primary text colors for contrast.
- All 32 standard color roles are provided in both modes. The source's warning and warningForeground roles are additional, matching extensions in both modes.
- Chart roles map onto existing timeline hues; sidebar roles reuse source surfaces because the app does not have an actual sidebar.
- Aptos and Segoe UI are not bundled. They render when installed locally; otherwise Arial or the system sans-serif fallback renders. No licensing rights for font-file redistribution are assumed.
- Georgia fills the unused serif schema slot, not a new recommendation for board UI.
- The source's destructive fill / white text pairing is retained for component fidelity but does not meet AA normal-text contrast. The source board's actual overdue treatment uses lighter-red text and tinted fills. Prefer that operational pattern rather than inventing a different source component.

## Using the package

Read docs/AGENTS.md and the relevant consumption guide before authoring another artifact on this design system. Import theme and components from the workspace package; never duplicate them. Before porting another family, read its exact source reference and dependency list. Keep business data, routing, filters and app-specific compositions in the app.

Do not apply the package to the Production Priority Board or change existing canvas frames until the user has separately approved application. Complete the required component inventory before any full migration.
