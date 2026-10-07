import { useState } from 'react';
import * as C from '../../components/ui/context-menu';
import { Button } from '../../components/ui/button';
import { Stack } from '../parts';

export function ContextMenuDemo() {
 const [checked,setChecked]=useState(true);
 const [view,setView]=useState('queue');
 const [selection,setSelection]=useState('Nothing selected');
 return <Stack><C.ContextMenu><C.ContextMenuTrigger asChild><div tabIndex={0} className="flex h-36 max-w-md items-center justify-center rounded-sm border border-dashed text-sm">Right-click for the context menu</div></C.ContextMenuTrigger><C.ContextMenuContent><C.ContextMenuGroup><C.ContextMenuLabel>Example actions</C.ContextMenuLabel><C.ContextMenuItem onSelect={()=>setSelection('Opened')}>Open<C.ContextMenuShortcut>Ctrl+O</C.ContextMenuShortcut></C.ContextMenuItem><C.ContextMenuItem disabled>Disabled action</C.ContextMenuItem></C.ContextMenuGroup><C.ContextMenuSeparator/><C.ContextMenuCheckboxItem checked={checked} onCheckedChange={value=>setChecked(value===true)}>Show detail</C.ContextMenuCheckboxItem><C.ContextMenuSeparator/><C.ContextMenuRadioGroup value={view} onValueChange={setView}><C.ContextMenuRadioItem value="queue">Queue</C.ContextMenuRadioItem><C.ContextMenuRadioItem value="schedule">Schedule</C.ContextMenuRadioItem></C.ContextMenuRadioGroup><C.ContextMenuSub><C.ContextMenuSubTrigger>More actions</C.ContextMenuSubTrigger><C.ContextMenuSubContent><C.ContextMenuItem onSelect={()=>setSelection('Nested action')}>Nested action</C.ContextMenuItem></C.ContextMenuSubContent></C.ContextMenuSub></C.ContextMenuContent></C.ContextMenu><p role="status" className="text-sm">{selection} · View: {view} · Detail: {checked?'on':'off'}</p></Stack>;
}
