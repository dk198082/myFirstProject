import { useState } from 'react';
import * as C from '../../components/ui/dropdown-menu';
import { Button } from '../../components/ui/button';
import { Stack } from '../parts';

export function DropdownMenuDemo() {
 const [checked,setChecked]=useState(true);
 const [view,setView]=useState('queue');
 const [selection,setSelection]=useState('Nothing selected');
 return <Stack><C.DropdownMenu><C.DropdownMenuTrigger asChild><Button variant="outline">Open dropdown menu</Button></C.DropdownMenuTrigger><C.DropdownMenuContent><C.DropdownMenuGroup><C.DropdownMenuLabel>Example actions</C.DropdownMenuLabel><C.DropdownMenuItem onSelect={()=>setSelection('Opened')}>Open<C.DropdownMenuShortcut>Ctrl+O</C.DropdownMenuShortcut></C.DropdownMenuItem><C.DropdownMenuItem disabled>Disabled action</C.DropdownMenuItem></C.DropdownMenuGroup><C.DropdownMenuSeparator/><C.DropdownMenuCheckboxItem checked={checked} onCheckedChange={value=>setChecked(value===true)}>Show detail</C.DropdownMenuCheckboxItem><C.DropdownMenuSeparator/><C.DropdownMenuRadioGroup value={view} onValueChange={setView}><C.DropdownMenuRadioItem value="queue">Queue</C.DropdownMenuRadioItem><C.DropdownMenuRadioItem value="schedule">Schedule</C.DropdownMenuRadioItem></C.DropdownMenuRadioGroup><C.DropdownMenuSub><C.DropdownMenuSubTrigger>More actions</C.DropdownMenuSubTrigger><C.DropdownMenuSubContent><C.DropdownMenuItem onSelect={()=>setSelection('Nested action')}>Nested action</C.DropdownMenuItem></C.DropdownMenuSubContent></C.DropdownMenuSub></C.DropdownMenuContent></C.DropdownMenu><p role="status" className="text-sm">{selection} · View: {view} · Detail: {checked?'on':'off'}</p></Stack>;
}
