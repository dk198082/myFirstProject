import { Fragment, useState } from 'react';
import * as C from '../../components/ui/label';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function LabelDemo() { return <Stack label="Labels"><C.Label htmlFor="label-name">Work order</C.Label><Input id="label-name" placeholder="Work order" /><div><C.Label htmlFor="label-disabled">Disabled field</C.Label><Input id="label-disabled" disabled /></div></Stack>; }
