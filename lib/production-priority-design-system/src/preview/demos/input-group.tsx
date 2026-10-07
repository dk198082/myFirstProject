import { Fragment, useState } from 'react';
import * as C from '../../components/ui/input-group';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function InputGroupDemo(){return <Stack>{(['inline-start','inline-end','block-start','block-end'] as const).map(align=><C.InputGroup key={align}><C.InputGroupAddon align={align}><C.InputGroupText>{align}</C.InputGroupText></C.InputGroupAddon><C.InputGroupInput aria-label={align+' input'} placeholder="Example value"/></C.InputGroup>)}<C.InputGroup><C.InputGroupTextarea aria-label="Grouped note" placeholder="Multiline text"/><C.InputGroupAddon align="block-end"><C.InputGroupText>Supporting text</C.InputGroupText>{(['xs','sm','icon-xs','icon-sm'] as const).map(size=><C.InputGroupButton key={size} size={size} aria-label={size+' action'}><PlusIcon/>{size.startsWith('icon')?null:size}</C.InputGroupButton>)}</C.InputGroupAddon></C.InputGroup><C.InputGroup><C.InputGroupInput disabled aria-label="Disabled grouped input" placeholder="Disabled"/></C.InputGroup><C.InputGroup><C.InputGroupInput aria-invalid="true" aria-label="Invalid grouped input" placeholder="Invalid state"/></C.InputGroup></Stack>; }
