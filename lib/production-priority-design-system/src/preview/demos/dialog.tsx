import { Fragment, useState } from 'react';
import * as C from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function DialogDemo() { return <C.Dialog><C.DialogTrigger asChild><Button variant="outline">Open dialog</Button></C.DialogTrigger><C.DialogContent><C.DialogHeader><C.DialogTitle>Preview details</C.DialogTitle><C.DialogDescription>This demonstrates the source modal, focus management and dismissal.</C.DialogDescription></C.DialogHeader><Label htmlFor="dialog-note">Note</Label><Input id="dialog-note" placeholder="Enter a note" /><C.DialogFooter><C.DialogClose asChild><Button>Done</Button></C.DialogClose></C.DialogFooter></C.DialogContent></C.Dialog>; }
