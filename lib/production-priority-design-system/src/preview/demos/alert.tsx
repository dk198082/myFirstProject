import { Fragment, useState } from 'react';
import * as C from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function AlertDemo() { return <Stack>{(['default','destructive'] as const).map(variant=><C.Alert key={variant} variant={variant}><InfoIcon className="h-4 w-4" /><C.AlertTitle>{variant==='default'?'Information':'Attention'}</C.AlertTitle><C.AlertDescription>Source {variant} alert with title, icon and description.</C.AlertDescription></C.Alert>)}</Stack>; }
