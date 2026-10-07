import { Fragment, useState } from 'react';
import * as C from '../../components/ui/accordion';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function AccordionDemo() { return <Stack><C.Accordion type="single" collapsible className="max-w-lg"><C.AccordionItem value="one"><C.AccordionTrigger>Single selection</C.AccordionTrigger><C.AccordionContent>Open and close with pointer or keyboard.</C.AccordionContent></C.AccordionItem><C.AccordionItem value="two"><C.AccordionTrigger>Second item</C.AccordionTrigger><C.AccordionContent>Opening this closes the first item.</C.AccordionContent></C.AccordionItem><C.AccordionItem value="disabled" disabled><C.AccordionTrigger>Disabled item</C.AccordionTrigger><C.AccordionContent>Unavailable.</C.AccordionContent></C.AccordionItem></C.Accordion><C.Accordion type="multiple" defaultValue={['a','b']} className="max-w-lg">{['a','b'].map(value=><C.AccordionItem key={value} value={value}><C.AccordionTrigger>Multiple / {value}</C.AccordionTrigger><C.AccordionContent>Both items can stay open.</C.AccordionContent></C.AccordionItem>)}</C.Accordion></Stack>; }
