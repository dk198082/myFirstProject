import { Fragment, useState } from 'react';
import * as C from '../../components/ui/sheet';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function SheetDemo() { return <Row label="Sides">{(['left','right','top','bottom'] as const).map(side=><C.Sheet key={side}><C.SheetTrigger asChild><Button variant="outline">Open {side} sheet</Button></C.SheetTrigger><C.SheetContent side={side}><C.SheetHeader><C.SheetTitle>Preview sheet</C.SheetTitle><C.SheetDescription>Source {side} placement with a keyboard-accessible close control.</C.SheetDescription></C.SheetHeader><p className="py-5 text-sm">A supporting panel, without application data.</p><C.SheetFooter><C.SheetClose asChild><Button>Close sheet</Button></C.SheetClose></C.SheetFooter></C.SheetContent></C.Sheet>)}</Row>; }
