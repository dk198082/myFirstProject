import { Fragment, useState } from 'react';
import * as C from '../../components/ui/collapsible';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function CollapsibleDemo() {const [open,setOpen]=useState(false);return <Stack><C.Collapsible open={open} onOpenChange={setOpen} className="max-w-md rounded-sm border p-4"><C.CollapsibleTrigger asChild><Button variant="outline">{open?'Hide':'Show'} supporting detail</Button></C.CollapsibleTrigger><C.CollapsibleContent className="mt-3 text-sm">Controlled expandable content.</C.CollapsibleContent></C.Collapsible><C.Collapsible disabled><C.CollapsibleTrigger asChild><Button variant="outline" disabled>Disabled collapsible</Button></C.CollapsibleTrigger><C.CollapsibleContent>Unavailable</C.CollapsibleContent></C.Collapsible></Stack>; }
