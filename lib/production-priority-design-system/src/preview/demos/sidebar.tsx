import { useState, type CSSProperties } from 'react';
import { HomeIcon, PlusIcon } from 'lucide-react';
import * as C from '../../components/ui/sidebar';
import { Button } from '../../components/ui/button';
import { Row, Stack } from '../parts';

function SidebarContents() {
  const { state, isMobile } = C.useSidebar();
  return <>
    <C.SidebarHeader><C.SidebarInput aria-label="Example sidebar search" placeholder="Search…" /></C.SidebarHeader>
    <C.SidebarSeparator />
    <C.SidebarContent>
      <C.SidebarGroup>
        <C.SidebarGroupLabel>Example navigation</C.SidebarGroupLabel>
        <C.SidebarGroupAction aria-label="Add example group"><PlusIcon /></C.SidebarGroupAction>
        <C.SidebarGroupContent>
          <C.SidebarMenu>
            {(['default', 'sm', 'lg'] as const).map(size => <C.SidebarMenuItem key={size}>
              <C.SidebarMenuButton size={size} variant={size === 'sm' ? 'outline' : 'default'} isActive={size === 'default'} tooltip={size + ' example'}>
                <HomeIcon /><span>{size} item</span>
              </C.SidebarMenuButton>
              <C.SidebarMenuBadge>3</C.SidebarMenuBadge>
              <C.SidebarMenuAction aria-label={size + ' item action'} showOnHover><PlusIcon /></C.SidebarMenuAction>
              {size === 'lg' ? <C.SidebarMenuSub><C.SidebarMenuSubItem>
                <C.SidebarMenuSubButton size="sm" href="#page=component-sidebar">Small sub-item</C.SidebarMenuSubButton>
                <C.SidebarMenuSubButton size="md" isActive href="#page=component-sidebar">Active sub-item</C.SidebarMenuSubButton>
              </C.SidebarMenuSubItem></C.SidebarMenuSub> : null}
            </C.SidebarMenuItem>)}
            <C.SidebarMenuItem><C.SidebarMenuButton disabled>Disabled item</C.SidebarMenuButton></C.SidebarMenuItem>
            <C.SidebarMenuItem><C.SidebarMenuSkeleton showIcon /></C.SidebarMenuItem>
          </C.SidebarMenu>
        </C.SidebarGroupContent>
      </C.SidebarGroup>
    </C.SidebarContent>
    <C.SidebarFooter><p className="text-xs">{isMobile ? 'Mobile' : state}</p></C.SidebarFooter>
    <C.SidebarRail />
  </>;
}

export function SidebarDemo() {
  const [open, setOpen] = useState(true);
  const [variant, setVariant] = useState<'sidebar' | 'floating' | 'inset'>('sidebar');
  const [collapsible, setCollapsible] = useState<'offcanvas' | 'icon' | 'none'>('icon');
  const [side, setSide] = useState<'left' | 'right'>('left');
  return <Stack>
    <Row label="Surface">{(['sidebar', 'floating', 'inset'] as const).map(value =>
      <Button key={value} variant={value === variant ? 'default' : 'outline'} onClick={() => setVariant(value)}>{value}</Button>)}</Row>
    <Row label="Collapse behavior">{(['offcanvas', 'icon', 'none'] as const).map(value =>
      <Button key={value} variant={value === collapsible ? 'default' : 'outline'} onClick={() => setCollapsible(value)}>{value}</Button>)}</Row>
    <Row label="Side"><Button variant="outline" onClick={() => setSide(value => value === 'left' ? 'right' : 'left')}>Side: {side}</Button></Row>
    <div className="relative h-96 overflow-hidden rounded-sm border [contain:layout_paint]">
      <C.SidebarProvider open={open} onOpenChange={setOpen} className="h-full min-h-0" style={{ '--sidebar-width': '13rem' } as CSSProperties}>
        {side === 'right' ? <C.SidebarInset className="min-w-0"><div className="p-4"><C.SidebarTrigger /><p className="mt-3 text-sm">Bounded example content</p></div></C.SidebarInset> : null}
        <C.Sidebar side={side} variant={variant} collapsible={collapsible} className="absolute! h-full!"><SidebarContents /></C.Sidebar>
        {side === 'left' ? <C.SidebarInset className="min-w-0"><div className="p-4"><C.SidebarTrigger /><p className="mt-3 text-sm">Bounded example content</p></div></C.SidebarInset> : null}
      </C.SidebarProvider>
    </div>
    <p className="text-xs text-muted-foreground">The source keyboard shortcut is Ctrl/Command + B. On phones, the source mobile sheet opens only after using the trigger.</p>
  </Stack>;
}
