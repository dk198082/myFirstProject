import { Fragment, useState } from 'react';
import * as C from '../../components/ui/toggle-group';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ToggleGroupDemo(){const [value,setValue]=useState('a');return <Stack>{(['default','outline'] as const).map(variant=>(['default','sm','lg'] as const).map(size=><C.ToggleGroup key={variant+size} type="single" variant={variant} size={size} value={value} onValueChange={setValue} aria-label={variant+' '+size+' group'}><C.ToggleGroupItem value="a" aria-label="First">A</C.ToggleGroupItem><C.ToggleGroupItem value="b" aria-label="Second">B</C.ToggleGroupItem><C.ToggleGroupItem value="c" disabled aria-label="Disabled">C</C.ToggleGroupItem></C.ToggleGroup>))}<C.ToggleGroup type="multiple" defaultValue={['a','b']} aria-label="Multiple selection"><C.ToggleGroupItem value="a">A</C.ToggleGroupItem><C.ToggleGroupItem value="b">B</C.ToggleGroupItem></C.ToggleGroup></Stack>; }
