# UX Standards Discovery — Field Service Schedule Board

**Status:** Evidence inventory for enterprise comparison; **not** an approved enterprise design system.  
**Scope:** Current `artifacts/field-service-schedule-board` React application, including its application shell, board, detail pages, write-backs page, dialogs, shared UI primitives and stylesheet. The API and the separate mockup sandbox are not UX sources for this inventory.  
**Method:** Source-code review of implemented markup, styles and interactions. This is not a measured accessibility audit or a claim that every shipped primitive is used. References below are workspace-relative to `artifacts/field-service-schedule-board/src/` unless stated otherwise.

## How to use this document

Compare these findings with inventories from other applications before promoting them into a shared TypeScript UX foundation. Preserve the distinction between what exists, what appears reusable, and what needs a human decision.

| Classification | Meaning here |
| --- | --- |
| **Standard** | A repeated or shared convention in this application that is a plausible cross-application baseline; not yet enterprise-approved. |
| **Candidate standard** | An intentional-looking reusable pattern that needs comparison or review. |
| **Application-specific** | A scheduling or Dynamics workflow choice that should stay local unless another product independently needs it. |
| **Inconsistent** | Comparable situations use conflicting patterns; no winner is implied. |
| **Unknown** | The reviewed implementation does not establish a convention. A component's availability alone is not evidence of use. |

The **Evidence** column cites actual code; a blank enterprise decision is deliberate. Do not treat the review recommendations as existing behavior.

## 1. Application shell

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Global frame | Full-height light background, dark horizontal header, padded main content (`px-6 py-6`). No global max-width is set in the shell. | `App.tsx:87-106` | Candidate standard |
| Identity and navigation | Calendar icon and product name; one visible global link, “Schedule Board,” with active and hover treatments. Separate routes exist for write-backs, work-order details and service-location details, but they are not all top-level header links. | `App.tsx:26-41,89-118` | Application-specific navigation; candidate active-link treatment |
| User area | Initials avatar, name/email or role, and “Sign out”; descriptive text hides below `sm` while the action remains visible. | `App.tsx:43-84` | Candidate standard |
| Authentication boundary | Loading/sign-in gate surrounds the routed UI; blocked-popup recovery is surfaced to the user. | `App.tsx:124-137`; `components/LoginGate.tsx:23-90` | Candidate standard |
| Sidebar, breadcrumbs, global search, help, global notifications and settings | None is mounted in this app shell. A sidebar primitive exists in `components/ui/sidebar.tsx`, but that is not evidence of a sidebar in this product. Search is board-local. | `App.tsx:87-121`; `pages/ScheduleBoard.tsx:3228-3250` | Unknown / not implemented in shell |
| Header responsiveness | User text is hidden on small screens; the header itself uses a single flex row with fixed padding. No application-shell mobile menu is mounted. | `App.tsx:55-83,89-104` | Candidate standard for compact account display; unknown for mobile navigation |
| Shell navigation gaps | The `/writebacks` route has no visible header destination. The active navigation link is styled but does not declare `aria-current`; narrow-screen navigation and overflow need review. | `App.tsx:26-41,89-118` | Inconsistent / review needed |

## 2. Layout and responsive behavior

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Page hierarchy | Page titles use `h1` with `text-2xl font-semibold tracking-tight`, followed by a muted `text-sm` explanation on the board and write-backs page. | `pages/ScheduleBoard.tsx:2928-2935`; `pages/Writebacks.tsx:97-105` | Standard |
| Page rhythm | Shell uses 24px padding (`px-6 py-6` at the current 4px Tailwind spacing unit); board sections use `space-y-5`, write-backs uses `space-y-6`; control bars use flex, gap and wrap. There is no single prescribed section gap. | `App.tsx:104`; `pages/ScheduleBoard.tsx:2928-2937,3011-3012`; `pages/Writebacks.tsx:97-99`; `index.css:133-134` | Candidate standard; spacing varies by context |
| Content containers | White `Card` surfaces contain tables, board sections and detail-page information. The board also uses heavier `border-2 border-foreground/80` for its main grid, unlike default cards. | `pages/ScheduleBoard.tsx:3455,3889,4241`; `pages/Writebacks.tsx:139-141`; `pages/WorkOrderDetail.tsx:82-343` | Candidate card pattern; board emphasis is application-specific |
| Dense scheduling grid | Week view uses a 180px resource column and minimum 1000px board; calendar uses at least 80px/day. Focused technician grid uses a 160px label and 140px/day. Overflow scrolling, not a condensed mobile schedule, accommodates narrow viewports. | `pages/ScheduleBoard.tsx:2919-2926,3452-3465` | Application-specific |
| Responsive tables | Write-backs table has horizontal overflow; board control rows wrap; detail-page tables similarly scroll rather than hiding columns. No universal responsive breakpoint policy is established by these uses. | `pages/Writebacks.tsx:139-151`; `pages/ScheduleBoard.tsx:2937,3100,3181`; `pages/WorkOrderDetail.tsx:278-310` | Candidate standard |
| Density | Compact `text-xs` labels/chips/search and small buttons support information-dense dispatch work. Do not carry this density into unrelated products by default. | `pages/ScheduleBoard.tsx:3103-3123,3181-3204,3228-3242` | Application-specific |

## 3. Typography

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Font stacks | Sans token is `Inter, sans-serif`; serif is `Georgia, serif`; mono is `Menlo, monospace`. Body uses sans and antialiasing. CSS establishes these stacks; it does not by itself prove the preferred font has loaded on every client. | `index.css:59-61,121-123,152-159` | Candidate standard |
| Headings and body | Board/write-backs page heading `text-2xl font-semibold`; descriptive body `text-sm text-muted-foreground`; board controls frequently use `text-xs font-bold uppercase tracking-wide`. | `pages/ScheduleBoard.tsx:2931-2934,3103-3105`; `pages/Writebacks.tsx:101-104` | Candidate standard |
| Compact numeric data | Booking IDs use monospace `text-xs`; dates and numbers commonly use `whitespace-nowrap` or tabular figures. | `pages/Writebacks.tsx:185-202`; `pages/ScheduleBoard.tsx:2953-2955` | Candidate standard |
| Formal type scale / line-height tokens | Tailwind text utilities are used, but the reviewed stylesheet does not declare an application-specific named type scale or line-height system. | `index.css:7-67,121-134`; `components/ui/button.tsx:7-36` | Unknown |

## 4. Color and visual tokens

The values below are **implemented light-theme source tokens** (HSL channels as stored in CSS). Hex equivalents are approximate sRGB conversions for comparison; use the CSS values as the source of truth. Although `@custom-variant dark` exists, the reviewed stylesheet does not define a `.dark` token palette; do not infer a supported dark theme.

| Token / use | Implemented CSS value | Approx. hex | Evidence | Classification |
| --- | --- | --- | --- | --- |
| Primary / focus ring / sidebar accent | `217 91% 60%` | `#3B82F6` | `index.css:88-92,98-99,113-115` | Candidate standard |
| Page background | `210 20% 98%` | `#F8FAFC` | `index.css:76` | Candidate standard |
| Surface / card / popover | `0 0% 100%` | `#FFFFFF` | `index.css:81-82,94-96` | Candidate standard |
| Main text / dark sidebar | `222 47% 11%` | `#0F172A` | `index.css:77,85` | Candidate standard |
| Muted text | `215 16% 47%` | `#64748B` | `index.css:104-105` | Candidate standard |
| Secondary / muted / accent fill | `210 40% 96%` | `#F1F5F9` | `index.css:101-108` | Candidate standard |
| Border / input border | `214 32% 91%` | `#E2E8F0` | `index.css:79,83,96,113` | Candidate standard |
| Destructive | `0 84% 60%` | `#EF4444` | `index.css:110-111` | Candidate standard |
| Chart palette 1–5 | `217 91% 60%`, `142 71% 45%`, `38 92% 50%`, `271 81% 56%`, `339 82% 52%` | About `#3B82F6`, `#22C55E`, `#F59E0B`, `#A855F7`, `#EC4899` | `index.css:115-119` | Candidate palette, **not** semantic success/warning/info tokens |
| Semantic success / warning / info | No dedicated root token is defined; local Tailwind colors, icons and badges convey these states. Do not equate chart colors with semantic roles. | `index.css:69-150`; `pages/Writebacks.tsx:211-231`; `pages/ScheduleBoard.tsx:1014-1069` | Unknown / inconsistent |
| Raw local colors | Some board cards use `bg-white` and blue utilities; ingestion and authentication warnings use amber utilities instead of semantic warning tokens. A dark variant declaration alone does not cover these surfaces. | `pages/ScheduleBoard.tsx:3344-3349,3889-3905`; `components/LoginGate.tsx:66-79`; `index.css:5,69-150` | Inconsistent |
| Interaction emphasis | Shared focus ring, disabled opacity `50%` and pointer-event suppression; custom hover-elevation overlays, with some locally overridden borders/hover states. | `components/ui/button.tsx:7-36`; `index.css:171-205`; `pages/ScheduleBoard.tsx:2980-3006` | Candidate standard; local variants need review |

**Other implemented foundations:** `--spacing: 0.25rem` (4px base); `--radius: .5rem` with `sm/md/lg/xl` derived by ±2/4px; shadow tokens `2xs`, `xs`, `sm`, default, `md`, `lg`, `xl`, `2xl` are defined. Their presence does not prove each elevation level is used. See `index.css:63-67,121-134`.

## 5. Buttons and actions

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Shared action primitive | `Button` exposes `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; sizes `default` (min-height 36px), `sm` (32px), `lg` (40px), `icon` (36×36px); `asChild` supports links. | `components/ui/button.tsx:7-65` | Standard |
| Primary vs secondary | Filled primary is used for “Sync to Dynamics”; outline is used for date navigation and reports. Save/cancel actions are paired in dialogs. These examples do not establish a universal one-primary-per-page rule. | `pages/Writebacks.tsx:106-135`; `pages/ScheduleBoard.tsx:2939-3008,3083-3094`; `components/EditBookingDialog.tsx:461-473` | Candidate standard |
| Icon-only actions | Date previous/next buttons have `aria-label` and icon; disabled shared buttons prevent pointer interaction and reduce opacity. | `pages/ScheduleBoard.tsx:2939-2947,2971-2979`; `components/ui/button.tsx:7-8` | Candidate standard |
| Pending actions | Sync and dialog saves use `Loader2` spinner and disabled controls during mutation. | `pages/Writebacks.tsx:106-114`; `components/EditBookingDialog.tsx:461-473` | Candidate standard |
| Destructive / irreversible action | Write-backs sync requires an `AlertDialog` naming the production impact; direct removal of scheduling items lacks the same confirmation. | `pages/Writebacks.tsx:106-135`; `pages/ScheduleBoard.tsx:3703-3727` | Inconsistent |

## 6. Forms and data entry

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Booking form | Radix dialog with date picker, separate hour/minute/AM-PM selects, technician selector and dispatcher note; save/cancel and spinner. Note saves on blur with a visual saved indicator. | `components/EditBookingDialog.tsx:135-201,230-283,381-473` | Application-specific control composition; candidate pending-action feedback |
| Potential-job / block forms | Type-selector buttons, conditional fields, date/time controls, notes and color choice; potential job requires a technician. | `components/AddBlockDialog.tsx:165-218,230-320`; `components/EditPlaceholderJobDialog.tsx:157-187` | Application-specific |
| Validation | Add/Edit Block require parseable end time after start; Edit Potential Job checks parseability but not ordering; Edit Booking has no equivalent client-side required/ordering check. Errors are generally shown as toasts rather than persistent field messages. | `components/AddBlockDialog.tsx:165-189`; `components/EditBlockDialog.tsx:215-245`; `components/EditPlaceholderJobDialog.tsx:157-187`; `components/EditBookingDialog.tsx:366-379` | Inconsistent |
| Accessible form infrastructure | Shared `form` / `field` primitives support `aria-invalid`, descriptions and alert messages, but scheduling dialogs do not consistently use them; some custom time selects and date-picker controls lack explicit associated accessible labels. | `components/ui/form.tsx:104-157`; `components/ui/field.tsx:186-224`; `components/EditBookingDialog.tsx:135-201,400-405` | Candidate infrastructure, inconsistent adoption |
| Unsaved-change handling | Booking note indicates save-in-progress/saved on blur. No application-wide leave-with-unsaved-changes convention is established by the reviewed forms. | `components/EditBookingDialog.tsx:230-283,417-445` | Unknown / application-specific note autosave |
| Numeric fields and autocomplete | No cross-page rule for sizing, label placement, number validation, autocomplete or read-only vs disabled distinction is established by the reviewed scheduling forms. | `components/EditBookingDialog.tsx:381-473`; `components/AddBlockDialog.tsx:230-434` | Unknown |

## 7. Tables and data grids

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Data table | Write-backs uses semantic `Table` parts inside a card with horizontally scrollable overflow; columns for booking, dates, technician, status and queued time. IDs are mono/small; dates do not wrap. | `pages/Writebacks.tsx:139-153,181-240` | Candidate standard |
| Table states | Loading row with spinner, load-error row with Retry, and empty row with a next action (“Edit a booking to stage one”). | `pages/Writebacks.tsx:153-179` | Candidate standard |
| Pagination, sorting, row selection, sticky headers, export | No such behavior is implemented on the write-backs table. Board calendar uses sticky headers and report export, but is a different scheduling interaction, not a general-purpose data grid. | `pages/Writebacks.tsx:139-245`; `pages/ScheduleBoard.tsx:3452-3465,3083-3094` | Unknown for shared tables; application-specific for calendar |

## 8. Status and state

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Write-back lifecycle | Failed = destructive badge plus error icon/tooltip; Synced = primary badge plus check icon; Queued = secondary badge plus clock icon. Labels and iconography accompany color. | `pages/Writebacks.tsx:181-231` | Application-specific statuses; candidate multi-cue treatment |
| Booking conflict | Amber ring/icon on tile, “Double-booked — time conflict” in detail, conflict drop-slot label. | `pages/ScheduleBoard.tsx:1014-1069,1131-1134,4116-4117` | Application-specific |
| Status vocabulary across products | Active, Inactive, Draft, Pending, Complete, Failed, Warning, Error, New, In Progress, On Hold and Archived do **not** share a unified mapping in this app. “Queued,” “Synced” and “Double-booked” are documented above instead; do not invent colors/icons for absent states. | `pages/Writebacks.tsx:181-231`; `pages/ScheduleBoard.tsx:1014-1069` | Unknown |
| Region and custom chip colors | Region dots and optional chip color choices distinguish scheduling items; they are not generic severity or lifecycle meanings. | `pages/ScheduleBoard.tsx:3185-3204`; `components/ChipColorPicker.tsx`; `components/AddBlockDialog.tsx:230-434` | Application-specific |

## 9. Notifications and feedback

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Toasts | Root-level Radix `Toaster`; default and destructive toast styles, title/description and dismiss control. Viewport is full-width at top on small screens and constrained to bottom-right at larger sizes. | `App.tsx:124-137`; `components/ui/toast.tsx:8-38,71-110` | Candidate standard |
| Mutation result | Write-backs sync reports counts on success/partial failure, “Nothing to sync” for no work and destructive error toast on failure. Dialogs also report save/delete success or failure. | `pages/Writebacks.tsx:62-93`; `components/EditPlaceholderJobDialog.tsx:111-146` | Candidate standard |
| Persistent feedback | Write-backs failures remain in the table with an error tooltip; degraded ingestion uses an inline `role="status"` message; board load errors appear inline. | `pages/Writebacks.tsx:211-231`; `pages/ScheduleBoard.tsx:3344-3364` | Candidate pattern; inconsistent recovery |
| Toast duration, dismissal policy and severity ladder | A close control and Radix viewport are defined; no product-wide explicit duration or informational/warning/success toast token set is established here. | `components/ui/toast.tsx:8-110`; `pages/Writebacks.tsx:62-93` | Unknown |

## 10. Dialogs and modals

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Modal foundation | Radix `Dialog` for editing/report flows and `AlertDialog` for explicit production confirmation. Shared components encapsulate overlay, content and action/footer parts. | `components/ui/dialog.tsx`; `components/ui/alert-dialog.tsx`; `components/EditBookingDialog.tsx:381-473`; `pages/Writebacks.tsx:106-135` | Candidate standard |
| Confirmation copy | Write-back confirmation names the affected count, target system, irreversible consequence and Cancel/Sync now actions. | `pages/Writebacks.tsx:122-135` | Candidate standard |
| Conflict prompt | Booking drag conflict uses native `window.confirm` instead of the styled dialog; its details and focus/visual experience therefore differ. | `pages/ScheduleBoard.tsx:1874-1903` | Inconsistent |
| Report workflow | One dialog supports technician and date selection, preview and PDF/Word/email actions. This sequence is tied to the calendar-report task, not a required enterprise modal format. | `components/CalendarReportDialog.tsx:249-515` | Application-specific |
| Modal width, backdrop/escape, multi-step policy | Shared Radix implementations exist, but no distinct app-wide modal-size or multi-step rule has been established. Verify actual wrapper behavior before adopting such a rule. | `components/ui/dialog.tsx`; `components/ui/alert-dialog.tsx` | Unknown |

## 11. Navigation and interaction

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Route navigation | Header link has active styling; detail routes are full pages, not drawers. | `App.tsx:26-41,87-121`; `pages/WorkOrderDetail.tsx`; `pages/ServiceLocationDetail.tsx` | Candidate active treatment; application-specific hierarchy |
| Calendar navigation | Previous/next, Today, next quarter/year and date picker; Week/Calendar tabs and group-by buttons show selected state. | `pages/ScheduleBoard.tsx:2937-3081` | Application-specific controls; candidate selected-state cues |
| Drag/drop | Booking, block and potential-job tiles move in the schedule grid with styled drop targets and conflict warning. Tiles can open with Enter, but a complete keyboard move/drop alternative is not apparent. | `pages/ScheduleBoard.tsx:584-610,737-780,3747-3825` | Application-specific; accessibility gap |
| Other navigation primitives | Accordion, drawer, tabs and breadcrumb files exist under `components/ui/`; their existence does **not** establish a deployed application pattern. | `components/ui/`; `App.tsx:87-121` | Unknown |

## 12. Loading, empty and error states

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Board loading | Skeleton loading for grid data. | `pages/ScheduleBoard.tsx:3351-3357` | Candidate standard |
| Table loading | Spinner in a full-width table row. | `pages/Writebacks.tsx:153-160` | Candidate standard; context-specific variant |
| Empty state | “No write-backs queued yet. Edit a booking to stage one”; board has no-regions and no-technician-match text. | `pages/Writebacks.tsx:174-179`; `pages/ScheduleBoard.tsx:3366-3371,4213-4217` | Candidate action-oriented copy; inconsistent detail |
| Error recovery | Write-backs load failure has Retry; board load error is generic without a retry control. Ingestion warning has `role="status"` but no direct remediation. | `pages/Writebacks.tsx:161-171`; `pages/ScheduleBoard.tsx:3344-3364` | Inconsistent |
| Technical details | Failed write-back error is exposed in a tooltip; mutation errors are toasted. No cross-app rule for safe technical detail visibility is established. | `pages/Writebacks.tsx:211-221,85-90` | Unknown |

## 13. Search and filtering

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Local search | Board search accepts work-order number, customer, city and technician; matching jobs remain prominent while nonmatching chips are dimmed, preserving schedule context. A future-date results panel has loading/empty behavior. | `pages/ScheduleBoard.tsx:3228-3260,3679-3686` | Application-specific matching; candidate clear-search affordance |
| Region and technician filters | Multi-select pill buttons with `aria-pressed` and explicit All/None controls; technician pill includes a region color dot. | `pages/ScheduleBoard.tsx:3098-3144,3179-3225` | Candidate interaction; application-specific entities |
| Weekend switch | `role="switch"` and `aria-checked` toggle visibility of Saturday/Sunday columns. | `pages/ScheduleBoard.tsx:3147-3174` | Application-specific |
| Saved filters, pagination and global search | Not established by these controls. | `App.tsx:87-121`; `pages/ScheduleBoard.tsx:3098-3260` | Unknown |

## 14. Accessibility (observed, not certified)

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Focus / disabled | Shared button uses visible focus ring and disabled opacity/pointer suppression. Icon-only previous/next actions have names. | `components/ui/button.tsx:7-8`; `pages/ScheduleBoard.tsx:2939-2947,2971-2979` | Candidate standard |
| Semantic selected controls | Board tabs use `role="tab"`/`aria-selected`; grouping/filter buttons use `aria-pressed`; weekend toggle uses switch semantics. | `pages/ScheduleBoard.tsx:3013-3081,3106-3119,3147-3174` | Candidate standard |
| State communication | Conflict icon has an accessible “Double-booked” label and visible text in expanded details; ingestion warning has `role="status"`. | `pages/ScheduleBoard.tsx:1014-1069,1131-1134,3344-3349` | Candidate standard |
| Keyboard completion | Enter opens tiles, but native drag/drop lacks an evidenced keyboard rescheduling path. Custom type buttons in block dialogs lack selected-state semantics. | `pages/ScheduleBoard.tsx:584-610,737-780,3781-3807`; `components/AddBlockDialog.tsx:230-281` | Inconsistent / gap |
| Field labels and alerts | Shared form primitives support descriptions and alert messages; some booking date/time controls lack explicit labels, and validation mainly uses transient toasts. | `components/ui/form.tsx:104-157`; `components/ui/field.tsx:186-224`; `components/EditBookingDialog.tsx:135-201,400-405` | Inconsistent / gap |
| Contrast, screen-reader walkthrough, mobile usability | Source review cannot establish contrast compliance or end-to-end assistive-technology usability. The dense board's overflow is not proof of mobile usability. | `index.css:69-150`; `pages/ScheduleBoard.tsx:2919-2926` | Unknown; requires testing |

## Reusable component inventory for a possible shared library

**Only the “used here” rows demonstrate product adoption.** The other files in `components/ui/` are available primitives, not approved UX standards. Props below name the important observed/API-facing controls rather than claiming a complete TypeScript signature.

| Current component | Purpose and visual/interaction behavior | Observed variants / props | Application dependency and reuse potential |
| --- | --- | --- | --- |
| `components/ui/button.tsx` `Button` | Accessible focus, disabled and hover-elevation baseline; native button or slotted child. | `variant`, `size`, `asChild`, native button props; variants/sizes in §5. | Low coupling; **high** reuse potential. |
| `components/ui/badge.tsx` `Badge` | Compact nonwrapping label with border, 2px vertical padding and hover-elevation. | `default`, `secondary`, `destructive`, `outline`, `className`. | Low coupling; **high**, but domain-to-variant semantics need separate decision. |
| `components/ui/card.tsx` `Card` | Surface container for pages, grids and detail groupings. | Card composition/`className`; board overrides border emphasis. | Low coupling; **high**. |
| `components/ui/table.tsx` `Table` family | Semantic table composition, headers, rows and cells. | Compositional children/`className`; page owns horizontal overflow. | Low coupling; **high**, but sorting/pagination not bundled. |
| `components/ui/dialog.tsx` / `alert-dialog.tsx` | Modal and explicit confirmation foundations. | Composed trigger/content/header/title/description/footer/action/cancel. | Low coupling; **high**; product copy and confirmation rules remain separate. |
| `components/ui/toast.tsx` + `hooks/use-toast.ts` | Dismissible feedback, mobile-top/desktop-bottom-right viewport. | Default/destructive, title/description/action, close. | Low coupling; **high**; duration/severity policy needs review. |
| `components/ui/input.tsx`, `select.tsx`, `form.tsx`, `field.tsx` | Data-entry controls; form primitives support descriptions/errors, but not all scheduling forms adopt them. | Input/select attributes, labels, error/description composition. | Low coupling; **high**, with adoption and validation conventions unresolved. |
| `components/ui/skeleton.tsx` | Loading placeholder used by board. | `className`. | Low coupling; **high**. |
| `components/LoginGate.tsx` | Auth loading/sign-in UI and popup-blocked recovery. | `children`; depends on app auth hook and login method. | **Medium** after isolating auth adapter and product copy. |
| `components/DateJumpPicker.tsx` | Calendar-based date jump for board. | `value`, `mode`, `onSelect`, `children` observed on board. | **Medium** for date navigation, but week/month meaning may remain local. |
| `components/ServiceLocationPicker.tsx` | Location selector for scheduling forms. | Location selection behavior and form context. | **Low** without separating service-location API/data model. |
| `components/ChipColorPicker.tsx` | Scheduling chip color customization. | Color selection used by block/potential-job forms. | **Low**; palette and persisted color meaning are product-specific. |
| `components/EditBookingDialog.tsx`, `AddBlockDialog.tsx`, `EditBlockDialog.tsx`, `EditPlaceholderJobDialog.tsx` | Scheduling create/edit/remove workflows with conditional fields, pending controls and toasts. | Domain-specific form fields, mutation hooks and role-dependent actions. | **Low** as whole components; extract only proven generic field/date/feedback patterns. |
| `components/CalendarReportDialog.tsx` | Technician/date report selection, preview and delivery. | Date range, technician selection, PDF/Word/email actions. | **Low** as a whole; step/progress patterns may be candidates after review. |

## Token extraction candidates for a future TypeScript foundation

The **existing** app tokens are CSS variables in `index.css`, mapped to Tailwind via `@theme inline`. Do not silently replace or rename them when making a future library. A mapping proposal (not implemented here):

| Future semantic group | Existing source | Decision before reuse |
| --- | --- | --- |
| `color.background`, `surface`, `text`, `textMuted`, `border`, `primary`, `secondary`, `error` | `--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--secondary`, `--destructive` (`index.css:69-114`) | Confirm these values against other apps; decide surface/card and error/destructive terminology. |
| `color.success`, `warning`, `info` | No corresponding root semantic tokens. | Define through comparison, not by relabeling chart colors. |
| `font.family.sans`, `.serif`, `.mono` | `--app-font-sans`, `--app-font-serif`, `--app-font-mono` (`index.css:121-123`) | Confirm font loading/licensing and intended usage. |
| `font.size.*`, `font.weight.*` | Tailwind utilities in components; no dedicated semantic CSS aliases. | Determine shared scale from multiple apps before minting tokens. |
| `space.*` | `--spacing: 0.25rem` plus Tailwind utilities (`index.css:134`) | Define named steps only after comparing layouts and component density. |
| `radius.sm/md/lg/xl` | `--radius: .5rem`, derived tokens (`index.css:63-67,124`) | Check cross-app radius and whether all levels are used. |
| `elevation.*` | `--shadow-2xs` through `--shadow-2xl` (`index.css:125-132`) | Inventory actual use; avoid exporting unused levels as policy. |

## Inconsistencies requiring human review

These are **findings**, not automatic choices of a winner.

| Pattern | Implementation A | Implementation B | Possible intended principle | Human-review recommendation |
| --- | --- | --- | --- | --- |
| Time-order validation | Add/Edit Block enforce valid end after start (`components/AddBlockDialog.tsx:165-179`; `EditBlockDialog.tsx:215-245`). | Potential-job edit checks parseability, booking edit lacks equivalent client check (`EditPlaceholderJobDialog.tsx:157-187`; `EditBookingDialog.tsx:366-379`). | Comparable time-range forms should validate coherently. | Agree on end-time, required-field and overnight rules; then choose inline feedback and server handling. |
| Destructive confirmation | Production write-back sync names impact and asks for confirmation (`pages/Writebacks.tsx:106-135`). | Board block/potential-job removal directly calls delete; drag conflict uses `window.confirm` (`pages/ScheduleBoard.tsx:3703-3727,1874-1903`). | High-impact actions need proportional warning and recovery. | Review each operation's reversibility; define when confirmation, undo or neither is appropriate. |
| Error recovery | Write-backs load error includes Retry (`pages/Writebacks.tsx:161-171`). | Board load error is generic without Retry (`pages/ScheduleBoard.tsx:3359-3364`). | Recoverable failures should offer a next step. | Decide retry placement, persistent error copy and safe detail exposure. |
| Error location | Write-back row failure details reside in a tooltip (`pages/Writebacks.tsx:211-221`). | Scheduling form validation and mutations mainly use toasts (`components/EditBookingDialog.tsx:298-337`; `AddBlockDialog.tsx:165-189`). | Errors should be discoverable where users can correct them. | Compare field, row and page error roles; do not force one presentation everywhere. |
| Selected-state accessibility | Board group/filter controls expose `aria-pressed` (`pages/ScheduleBoard.tsx:3047-3081,3106-3119`). | Block-type selectors are visually selected without equivalent state semantics (`components/AddBlockDialog.tsx:230-281`; `EditBlockDialog.tsx:256-296`). | Visually selected controls should announce selection. | Choose toggle/radio semantics appropriate to each control and test keyboard interaction. |
| Modal descriptions | Booking dialog uses Radix title/description (`components/EditBookingDialog.tsx:381-473`). | Report dialog uses a plain paragraph for its explanatory text (`components/CalendarReportDialog.tsx:503-515`). | Important dialog context should be programmatically associated. | Check shared dialog accessibility expectations before standardizing. |
| Primary-looking borders | Shared outline button has subtle default border (`components/ui/button.tsx:18-25`). | Date/report buttons locally force stronger `border-2 border-foreground/30` (`pages/ScheduleBoard.tsx:2980-3006,3083-3094`). | Emphasis should express action hierarchy consistently. | Decide whether the board needs a named high-emphasis secondary variant rather than scattered overrides. |

## Decisions that should **not** become enterprise standards by default

- The technician-by-region/service-location swimlanes, minimum day-column widths, weekends toggle, capacity panel and calendar-chip drag/drop exist for dispatch scheduling (`pages/ScheduleBoard.tsx:2919-2926,3047-3081,3147-3174,3452-3465,4698-4759`).
- “Potential Job,” “Travel,” “PTO,” “Queued write-back,” “Synced” and “Double-booked” express this product's domain and integration state, not general status language (`components/AddBlockDialog.tsx:50-219`; `pages/Writebacks.tsx:181-231`; `pages/ScheduleBoard.tsx:1014-1069`).
- Dynamics production-sync confirmation copy and report delivery options are business-process choices, although the generic confirmation and progress patterns may be reusable (`pages/Writebacks.tsx:122-135`; `components/CalendarReportDialog.tsx:249-515`).
- The board's compact density, color-customized scheduling tiles and search-that-dims-nonmatches optimize this particular grid. They should not set default density, color semantics or search behavior for unrelated applications (`pages/ScheduleBoard.tsx:3100-3242,3679-3742`).

## Enterprise consolidation checklist

1. Compare **observed** patterns and tokens with other app inventories; record adoption and exceptions.
2. Resolve the human-review items above before asserting shared form, status, action or error standards.
3. Test keyboard rescheduling, accessible names, contrast and narrow-screen workflows; source review does not certify them.
4. Build shared TypeScript components/tokens only after choosing a semantic API; keep domain-specific booking, technician and Dynamics behavior in this application.