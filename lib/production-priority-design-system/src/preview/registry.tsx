import { lazy, type ComponentType } from 'react';
import { OverviewPage, ColorsPage, FontsPage, LayoutPage } from './foundations';
export type PreviewEntry = { id: string; name: string; description: string; Page: ComponentType };
export type NavGroup = { name: string; entries: PreviewEntry[] };
export const DESIGN_SYSTEM = { title: 'Production Priority Board Design System', description: 'The board’s green-and-lime visual language, extracted into reusable foundations and all 54 source component families.' };
export const OVERVIEW_ENTRY: PreviewEntry = { id: 'overview', name: 'Overview', description: 'Foundations and the complete extracted component catalog.', Page: OverviewPage };
export const NAV_GROUPS: NavGroup[] = [
 {name:'Colors', entries:[{id:'color-roles',name:'Color roles',description:'Source dark colors and a separately derived light palette.',Page:ColorsPage}]},
 {name:'Fonts', entries:[{id:'font-families',name:'Typography',description:'Source system font stack and compact type hierarchy.',Page:FontsPage}]},
 {name:'Layout', entries:[{id:'layout-foundations',name:'Spacing and surfaces',description:'Four-pixel spacing, sharp corners and bounded dense layouts.',Page:LayoutPage}]},
 {name:"Actions", entries:[
  {id:"component-button", name:"Button", description:"Source variants, sizes and disabled states.", Page:lazy(() => import("./demos/button").then(m => ({default:m.ButtonDemo})))},
  {id:"component-button-group", name:"Button Group", description:"Source-backed button group composition and important states.", Page:lazy(() => import("./demos/button-group").then(m => ({default:m.ButtonGroupDemo})))},
  {id:"component-toggle", name:"Toggle", description:"Source-backed toggle composition and important states.", Page:lazy(() => import("./demos/toggle").then(m => ({default:m.ToggleDemo})))},
  {id:"component-toggle-group", name:"Toggle Group", description:"Source-backed toggle group composition and important states.", Page:lazy(() => import("./demos/toggle-group").then(m => ({default:m.ToggleGroupDemo})))},
 ]},
 {name:"Forms & inputs", entries:[
  {id:"component-label", name:"Label", description:"Accessible labels tied to their inputs.", Page:lazy(() => import("./demos/label").then(m => ({default:m.LabelDemo})))},
  {id:"component-input", name:"Input", description:"Source-backed input composition and important states.", Page:lazy(() => import("./demos/input").then(m => ({default:m.InputDemo})))},
  {id:"component-textarea", name:"Textarea", description:"Source-backed textarea composition and important states.", Page:lazy(() => import("./demos/textarea").then(m => ({default:m.TextareaDemo})))},
  {id:"component-field", name:"Field", description:"Source-backed field composition and important states.", Page:lazy(() => import("./demos/field").then(m => ({default:m.FieldDemo})))},
  {id:"component-form", name:"Form", description:"React Hook Form validation, errors, submission and reset.", Page:lazy(() => import("./demos/form").then(m => ({default:m.FormDemo})))},
  {id:"component-input-group", name:"Input Group", description:"Source-backed input group composition and important states.", Page:lazy(() => import("./demos/input-group").then(m => ({default:m.InputGroupDemo})))},
  {id:"component-input-otp", name:"Input OTP", description:"Controlled six-character input and disabled state.", Page:lazy(() => import("./demos/input-otp").then(m => ({default:m.InputOtpDemo})))},
  {id:"component-checkbox", name:"Checkbox", description:"Source-backed checkbox composition and important states.", Page:lazy(() => import("./demos/checkbox").then(m => ({default:m.CheckboxDemo})))},
  {id:"component-radio-group", name:"Radio Group", description:"Source-backed radio group composition and important states.", Page:lazy(() => import("./demos/radio-group").then(m => ({default:m.RadioGroupDemo})))},
  {id:"component-select", name:"Select", description:"Source-backed select composition and important states.", Page:lazy(() => import("./demos/select").then(m => ({default:m.SelectDemo})))},
  {id:"component-switch", name:"Switch", description:"Source-backed switch composition and important states.", Page:lazy(() => import("./demos/switch").then(m => ({default:m.SwitchDemo})))},
  {id:"component-slider", name:"Slider", description:"Source-backed slider composition and important states.", Page:lazy(() => import("./demos/slider").then(m => ({default:m.SliderDemo})))},
  {id:"component-calendar", name:"Calendar", description:"Single, range and multiple-date selection.", Page:lazy(() => import("./demos/calendar").then(m => ({default:m.CalendarDemo})))},
 ]},
 {name:"Overlays", entries:[
  {id:"component-dialog", name:"Dialog", description:"Source-backed dialog composition and important states.", Page:lazy(() => import("./demos/dialog").then(m => ({default:m.DialogDemo})))},
  {id:"component-alert-dialog", name:"Alert Dialog", description:"Source-backed alert dialog composition and important states.", Page:lazy(() => import("./demos/alert-dialog").then(m => ({default:m.AlertDialogDemo})))},
  {id:"component-sheet", name:"Sheet", description:"All four sheet placements with accessible dismissal.", Page:lazy(() => import("./demos/sheet").then(m => ({default:m.SheetDemo})))},
  {id:"component-drawer", name:"Drawer", description:"Source-backed drawer composition and important states.", Page:lazy(() => import("./demos/drawer").then(m => ({default:m.DrawerDemo})))},
  {id:"component-popover", name:"Popover", description:"Source-backed popover composition and important states.", Page:lazy(() => import("./demos/popover").then(m => ({default:m.PopoverDemo})))},
  {id:"component-tooltip", name:"Tooltip", description:"Source-backed tooltip composition and important states.", Page:lazy(() => import("./demos/tooltip").then(m => ({default:m.TooltipDemo})))},
  {id:"component-hover-card", name:"Hover Card", description:"Source-backed hover card composition and important states.", Page:lazy(() => import("./demos/hover-card").then(m => ({default:m.HoverCardDemo})))},
 ]},
 {name:"Menus & navigation", entries:[
  {id:"component-breadcrumb", name:"Breadcrumb", description:"Source-backed breadcrumb composition and important states.", Page:lazy(() => import("./demos/breadcrumb").then(m => ({default:m.BreadcrumbDemo})))},
  {id:"component-navigation-menu", name:"Navigation Menu", description:"Source-backed navigation menu composition and important states.", Page:lazy(() => import("./demos/navigation-menu").then(m => ({default:m.NavigationMenuDemo})))},
  {id:"component-menubar", name:"Menubar", description:"Source-backed menubar composition and important states.", Page:lazy(() => import("./demos/menubar").then(m => ({default:m.MenubarDemo})))},
  {id:"component-dropdown-menu", name:"Dropdown Menu", description:"Source-backed dropdown menu composition and important states.", Page:lazy(() => import("./demos/dropdown-menu").then(m => ({default:m.DropdownMenuDemo})))},
  {id:"component-context-menu", name:"Context Menu", description:"Source-backed context menu composition and important states.", Page:lazy(() => import("./demos/context-menu").then(m => ({default:m.ContextMenuDemo})))},
  {id:"component-command", name:"Command", description:"Source-backed command composition and important states.", Page:lazy(() => import("./demos/command").then(m => ({default:m.CommandDemo})))},
  {id:"component-pagination", name:"Pagination", description:"Source-backed pagination composition and important states.", Page:lazy(() => import("./demos/pagination").then(m => ({default:m.PaginationDemo})))},
 ]},
 {name:"Data display", entries:[
  {id:"component-carousel", name:"Carousel", description:"Horizontal and vertical source carousel with previous/next controls.", Page:lazy(() => import("./demos/carousel").then(m => ({default:m.CarouselDemo})))},
  {id:"component-badge", name:"Badge", description:"Source-backed badge composition and important states.", Page:lazy(() => import("./demos/badge").then(m => ({default:m.BadgeDemo})))},
  {id:"component-card", name:"Card", description:"Source-backed card composition and important states.", Page:lazy(() => import("./demos/card").then(m => ({default:m.CardDemo})))},
  {id:"component-avatar", name:"Avatar", description:"Source-backed avatar composition and important states.", Page:lazy(() => import("./demos/avatar").then(m => ({default:m.AvatarDemo})))},
  {id:"component-table", name:"Table", description:"Source-backed table composition and important states.", Page:lazy(() => import("./demos/table").then(m => ({default:m.TableDemo})))},
  {id:"component-chart", name:"Chart", description:"Illustrative Recharts samples, themed tooltips and legends.", Page:lazy(() => import("./demos/chart").then(m => ({default:m.ChartDemo})))},
  {id:"component-item", name:"Item", description:"Source-backed item composition and important states.", Page:lazy(() => import("./demos/item").then(m => ({default:m.ItemDemo})))},
  {id:"component-kbd", name:"Keyboard hints", description:"Source-backed keyboard hints composition and important states.", Page:lazy(() => import("./demos/kbd").then(m => ({default:m.KbdDemo})))},
  {id:"component-aspect-ratio", name:"Aspect Ratio", description:"Source-backed aspect ratio composition and important states.", Page:lazy(() => import("./demos/aspect-ratio").then(m => ({default:m.AspectRatioDemo})))},
 ]},
 {name:"Feedback", entries:[
  {id:"component-empty", name:"Empty states", description:"Source empty-state media, content and actions.", Page:lazy(() => import("./demos/empty").then(m => ({default:m.EmptyDemo})))},
  {id:"component-alert", name:"Alert", description:"Source-backed alert composition and important states.", Page:lazy(() => import("./demos/alert").then(m => ({default:m.AlertDemo})))},
  {id:"component-toast", name:"Toast", description:"Packaged toast store, actions, variants and dismissal.", Page:lazy(() => import("./demos/toast").then(m => ({default:m.ToastDemo})))},
  {id:"component-sonner", name:"Sonner", description:"Notifications with the source theme provider.", Page:lazy(() => import("./demos/sonner").then(m => ({default:m.SonnerDemo})))},
  {id:"component-skeleton", name:"Skeleton", description:"Source-backed skeleton composition and important states.", Page:lazy(() => import("./demos/skeleton").then(m => ({default:m.SkeletonDemo})))},
  {id:"component-spinner", name:"Spinner", description:"Source-backed spinner composition and important states.", Page:lazy(() => import("./demos/spinner").then(m => ({default:m.SpinnerDemo})))},
  {id:"component-progress", name:"Progress", description:"Source-backed progress composition and important states.", Page:lazy(() => import("./demos/progress").then(m => ({default:m.ProgressDemo})))},
 ]},
 {name:"Structure", entries:[
  {id:"component-tabs", name:"Tabs", description:"Controlled panels with disabled tabs and keyboard navigation.", Page:lazy(() => import("./demos/tabs").then(m => ({default:m.TabsDemo})))},
  {id:"component-accordion", name:"Accordion", description:"Source-backed accordion composition and important states.", Page:lazy(() => import("./demos/accordion").then(m => ({default:m.AccordionDemo})))},
  {id:"component-collapsible", name:"Collapsible", description:"Source-backed collapsible composition and important states.", Page:lazy(() => import("./demos/collapsible").then(m => ({default:m.CollapsibleDemo})))},
  {id:"component-separator", name:"Separator", description:"Source-backed separator composition and important states.", Page:lazy(() => import("./demos/separator").then(m => ({default:m.SeparatorDemo})))},
  {id:"component-resizable", name:"Resizable", description:"Source-backed resizable composition and important states.", Page:lazy(() => import("./demos/resizable").then(m => ({default:m.ResizableDemo})))},
  {id:"component-scroll-area", name:"Scroll Area", description:"Source-backed scroll area composition and important states.", Page:lazy(() => import("./demos/scroll-area").then(m => ({default:m.ScrollAreaDemo})))},
  {id:"component-sidebar", name:"Sidebar", description:"Bounded layout with source variants, collapse modes and keyboard shortcut.", Page:lazy(() => import("./demos/sidebar").then(m => ({default:m.SidebarDemo})))},
 ]},
];
export const ALL_ENTRIES=[OVERVIEW_ENTRY,...NAV_GROUPS.flatMap(group=>group.entries)];
if(new Set(ALL_ENTRIES.map(entry=>entry.id)).size!==ALL_ENTRIES.length) throw new Error('Design-system page IDs must be unique.');
