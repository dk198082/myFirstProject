import { useState } from 'react';
import * as C from '../../components/ui/menubar';
import { Button } from '../../components/ui/button';
import { Stack } from '../parts';

export function MenubarDemo() {
 const [checked,setChecked]=useState(true);
 const [view,setView]=useState('queue');
 const [selection,setSelection]=useState('Nothing selected');
 return <Stack><C.Menubar><C.MenubarMenu><C.MenubarTrigger>File</C.MenubarTrigger><C.MenubarContent><C.MenubarGroup><C.MenubarLabel>Example actions</C.MenubarLabel><C.MenubarItem onSelect={()=>setSelection('Opened')}>Open<C.MenubarShortcut>Ctrl+O</C.MenubarShortcut></C.MenubarItem><C.MenubarItem disabled>Disabled action</C.MenubarItem></C.MenubarGroup><C.MenubarSeparator/><C.MenubarCheckboxItem checked={checked} onCheckedChange={value=>setChecked(value===true)}>Show detail</C.MenubarCheckboxItem><C.MenubarSeparator/><C.MenubarRadioGroup value={view} onValueChange={setView}><C.MenubarRadioItem value="queue">Queue</C.MenubarRadioItem><C.MenubarRadioItem value="schedule">Schedule</C.MenubarRadioItem></C.MenubarRadioGroup><C.MenubarSub><C.MenubarSubTrigger>More actions</C.MenubarSubTrigger><C.MenubarSubContent><C.MenubarItem onSelect={()=>setSelection('Nested action')}>Nested action</C.MenubarItem></C.MenubarSubContent></C.MenubarSub></C.MenubarContent></C.MenubarMenu><C.MenubarMenu><C.MenubarTrigger>Help</C.MenubarTrigger><C.MenubarContent><C.MenubarItem onSelect={()=>setSelection('Help')}>Documentation</C.MenubarItem></C.MenubarContent></C.MenubarMenu></C.Menubar><p role="status" className="text-sm">{selection} · View: {view} · Detail: {checked?'on':'off'}</p></Stack>;
}
