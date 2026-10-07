import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { tokens } from '../generated/tokens';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Guidelines } from './parts';

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="min-w-0 rounded-sm border bg-card/60 p-5">
    <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">{title}</h2>
    {children}
  </Card>;
}

function CorePalette() {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {([
      ['primary', 'bg-primary', 'Active selection · priority · action'],
      ['secondary', 'bg-secondary', 'Supporting surfaces'],
      ['accent', 'bg-accent', 'Hover and related emphasis'],
    ] as const).map(([name, style, meaning]) => <div key={name} className="overflow-hidden rounded-sm border">
      <div className={`h-16 ${style}`} />
      <div className="p-3">
        <p className="text-sm font-semibold capitalize">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{meaning}</p>
      </div>
    </div>)}
  </div>;
}

export function OverviewPage() {
  return <div className="space-y-6">
    <div className="border-l-2 border-primary bg-primary/5 px-4 py-3 text-sm">
      <p className="font-semibold">Complete extraction · 54 source component families</p>
      <p className="mt-1 text-muted-foreground">Dark mode follows the existing board. Light mode is a derived alternative, not an existing board theme. The source app and canvas have not been modified.</p>
    </div>
    <Panel title="Core palette"><CorePalette /></Panel>
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Primary action</Button><Button variant="outline">Outline</Button>
          <Button variant="secondary">Secondary</Button><Button disabled>Disabled</Button>
        </div>
      </Panel>
      <Panel title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge><Badge variant="secondary">Secondary</Badge>
          <Badge variant="warning">Warning</Badge><Badge variant="outline">Outline</Badge>
        </div>
      </Panel>
      <Panel title="Inputs">
        <label htmlFor="overview-order" className="mb-2 block text-[10px] uppercase tracking-wider text-muted-foreground">Work order filter</label>
        <Input id="overview-order" placeholder="Enter a work order…" className="max-w-sm" />
      </Panel>
      <Panel title="Tooltips">
        <TooltipProvider delayDuration={150}>
          <Tooltip><TooltipTrigger asChild><Button variant="outline">Hover or focus for help</Button></TooltipTrigger>
            <TooltipContent side="top">Remaining/Planned</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Panel>
      <Panel title="Switches and labels">
        <div className="flex items-center gap-3"><Switch id="overview-switch" /><Label htmlFor="overview-switch">Example control</Label></div>
      </Panel>
      <Panel title="Cards">
        <p className="text-sm font-semibold">Source card surface</p>
        <p className="mt-2 text-xs text-muted-foreground">Reusable bordered content region, composed from the extracted Card component.</p>
      </Panel>
    </div>
    <Panel title="Separators">
      <div className="flex h-5 items-center gap-4 text-sm"><span>Horizontal</span><Separator orientation="vertical" decorative={false} /><span>Vertical</span></div>
      <Separator className="my-4" decorative={false} />
      <p className="text-xs text-muted-foreground">Thin borders define regions without heavy shadows.</p>
    </Panel>
    <Panel title="Typography and layout">
      <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Compact operational labels</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-primary">1,551</p>
      <p className="mt-2 text-sm">Aptos → Segoe UI → Arial → system sans-serif</p>
      <p className="mt-2 text-xs text-muted-foreground">4px spacing step · 2px base radius · restrained borders · dense data display</p>
    </Panel>
    <p className="text-xs text-muted-foreground">Browse all 54 families in the sidebar. Applying this system to the board or existing canvas mockups still requires separate approval.</p>
  </div>;
}

export function ColorsPage() {
  return <div className="space-y-6">
    <Panel title="Core palette"><CorePalette /></Panel>
    <Panel title="Supporting roles">
      <div className="grid gap-3 sm:grid-cols-3">
        {['background', 'foreground', 'card', 'popover', 'muted', 'border', 'input', 'ring', 'destructive', 'warning'].map(role =>
          <div key={role} className="flex items-center gap-3 rounded-sm border p-3">
            <span className="h-9 w-9 shrink-0 rounded-sm border" style={{ background: `hsl(var(--${role}))` }} />
            <span className="text-xs">{role}</span>
          </div>)}
      </div>
    </Panel>
    <Panel title="Timeline palette">
      <div className="flex flex-wrap gap-4">
        {['Build window', 'Ship date', 'Past-due fill', 'Incomplete dates', 'Past-due marker'].map((name, index) =>
          <div key={name} className="flex items-center gap-2 text-xs">
            <span className="h-4 w-6 border" style={{ background: `hsl(var(--chart-${index + 1}))` }} />{name}
          </div>)}
      </div>
    </Panel>
    <Panel title="Source and derived values">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead><tr className="border-b"><th className="py-2">Role</th><th>Source dark</th><th>Derived light</th></tr></thead>
          <tbody>{Object.entries(tokens.color.dark).map(([role, dark]) =>
            <tr key={role} className="border-b border-border/50"><td className="py-2 font-medium">{role}</td><td>{dark}</td><td>{tokens.color.light[role as keyof typeof tokens.color.light]}</td></tr>)}</tbody>
        </table>
      </div>
    </Panel>
    <Guidelines items={[
      { kind: 'do', text: 'Use lime for active controls and priority emphasis, as on the source board.' },
      { kind: 'do', text: 'Keep overdue and incomplete-date labels alongside their color indicators.' },
      { kind: 'dont', text: 'Treat the derived light palette as a theme already used by the board.' },
    ]} />
    <p className="text-xs text-muted-foreground">The source’s destructive fill with white text is retained for fidelity but is not an AA contrast pair. The board’s actual overdue indicators use lighter red text and tinted fills; prefer that pattern for operational warnings.</p>
  </div>;
}

export function FontsPage() {
  return <div className="space-y-6">
    <Panel title="Font families">
      <p className="text-xl font-semibold">Aptos / Segoe UI / Arial</p>
      <p className="mt-3 text-sm text-muted-foreground">The source uses a local system-font stack. No font files are bundled or redistributed. If Aptos or Segoe UI is unavailable, Arial or the platform’s sans-serif font renders instead.</p>
      <p className="mt-3 text-sm">The board’s “mono” utility intentionally uses this same sans-serif stack. It is not a separate monospaced typeface.</p>
      <p className="mt-3 font-serif text-sm text-muted-foreground">Georgia is an unused schema fallback, not part of the board’s UI typography.</p>
    </Panel>
    <Panel title="Source hierarchy">
      <div className="space-y-5">
        <div><p className="text-lg font-bold tracking-[0.08em] text-primary">PRODUCTION PRIORITY BOARD</p><p className="mt-1 text-xs text-muted-foreground">16–18px · bold · product heading</p></div>
        <div><p className="text-xl font-bold tabular-nums text-primary">2,805</p><p className="mt-1 text-xs text-muted-foreground">20px · bold · KPI values</p></div>
        <div><p className="text-sm font-bold">WO-EXAMPLE</p><p className="mt-1 text-xs text-muted-foreground">14px · bold · work-order emphasis</p></div>
        <div><p className="text-xs font-semibold">PART / DESCRIPTION</p><p className="mt-1 text-xs text-muted-foreground">12px · semibold · grid detail</p></div>
        <div><p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Status / Production group</p><p className="mt-1 text-xs text-muted-foreground">9–10px · uppercase · field and filter labels</p></div>
      </div>
    </Panel>
    <Guidelines items={[{ kind: 'do', text: 'Distinguish compact uppercase labels from bold numeric values and order identifiers.' }]} />
  </div>;
}

export function LayoutPage() {
  return <div className="space-y-6">
    <Panel title="Spacing">
      <div className="space-y-3">{[4, 8, 12, 16, 24].map(size =>
        <div key={size} className="flex items-center gap-4"><span className="w-10 text-xs">{size}px</span><span className="h-3 bg-primary" style={{ width: size * 5 }} /></div>)}</div>
      <p className="mt-4 text-sm text-muted-foreground">Source layout uses a 4px base step, 8–12px control gaps and 16–24px page gutters.</p>
    </Panel>
    <Panel title="Surfaces and corners">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-sm border bg-background p-4"><p className="text-sm">Background</p></div>
        <div className="rounded-sm border bg-card p-4"><p className="text-sm">Card</p></div>
        <div className="rounded-sm border bg-muted p-4"><p className="text-sm">Muted</p></div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">The source’s base radius is 2px. Shared controls retain their exact source radius utilities; status badges retain their pill shape.</p>
    </Panel>
    <Panel title="Density and scrolling">
      <p className="text-sm text-muted-foreground">The board caps its content width at 1800px. The Gantt uses 38px rows with fixed order labels, and dense data surfaces scroll internally rather than widening the page.</p>
    </Panel>
    <Guidelines items={[
      { kind: 'do', text: 'Use thin green borders and subtle surface tinting to separate dense operational data.' },
      { kind: 'do', text: 'Keep horizontal scrolling inside wide tables and timelines.' },
    ]} />
  </div>;
}
