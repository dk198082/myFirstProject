import { Fragment, useState } from 'react';
import * as C from '../../components/ui/popover';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function PopoverDemo(){return <Row label="Placements">{(['top','right','bottom','left'] as const).map(side=><C.Popover key={side}><C.PopoverAnchor asChild><span><C.PopoverTrigger asChild><Button variant="outline">{side} popover</Button></C.PopoverTrigger></span></C.PopoverAnchor><C.PopoverContent side={side}><Label htmlFor={'popover-'+side}>Example reference</Label><Input id={'popover-'+side} className="mt-2" placeholder="Enter a reference" /></C.PopoverContent></C.Popover>)}</Row>; }
