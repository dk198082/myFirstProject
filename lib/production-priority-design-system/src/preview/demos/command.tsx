import { Fragment, useState } from 'react';
import * as C from '../../components/ui/command';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function CommandDemo() {const [selected,setSelected]=useState('Nothing selected');const [open,setOpen]=useState(false);const items=<><C.CommandInput aria-label="Search example commands" placeholder="Search examples…"/><C.CommandList><C.CommandEmpty>No results found.</C.CommandEmpty><C.CommandGroup heading="Examples"><C.CommandItem onSelect={()=>{setSelected('Queue');setOpen(false);}}>Queue<C.CommandShortcut>Q</C.CommandShortcut></C.CommandItem><C.CommandItem onSelect={()=>{setSelected('Schedule');setOpen(false);}}>Schedule</C.CommandItem><C.CommandItem disabled>Disabled command</C.CommandItem></C.CommandGroup><C.CommandSeparator/><C.CommandGroup heading="Documentation"><C.CommandItem onSelect={()=>setSelected('Help')}>Help</C.CommandItem></C.CommandGroup></C.CommandList></>;return <Stack><C.Command className="max-w-md rounded-sm border">{items}</C.Command><Button variant="outline" onClick={()=>setOpen(true)}>Open command dialog</Button><C.CommandDialog open={open} onOpenChange={setOpen}><span className="sr-only"><DialogTitle>Example command menu</DialogTitle><DialogDescription>Search and select an example command.</DialogDescription></span>{items}</C.CommandDialog><p role="status" className="text-sm">{selected}</p></Stack>; }
