import { Fragment, useState } from 'react';
import * as C from '../../components/ui/drawer';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function DrawerDemo() {return <DrawerExample/>; }
function DrawerExample(){const [direction,setDirection]=useState<'top'|'bottom'|'left'|'right'>('bottom');return <Stack><Row label="Direction">{(['top','bottom','left','right'] as const).map(value=><Button key={value} variant={value===direction?'default':'outline'} onClick={()=>setDirection(value)}>{value}</Button>)}</Row><C.Drawer direction={direction}><C.DrawerTrigger asChild><Button variant="outline">Open drawer</Button></C.DrawerTrigger><C.DrawerContent><C.DrawerHeader><C.DrawerTitle>Source drawer</C.DrawerTitle><C.DrawerDescription>Drag, dismiss, or use the close control.</C.DrawerDescription></C.DrawerHeader><C.DrawerFooter><C.DrawerClose asChild><Button>Close drawer</Button></C.DrawerClose></C.DrawerFooter></C.DrawerContent></C.Drawer></Stack>; }
