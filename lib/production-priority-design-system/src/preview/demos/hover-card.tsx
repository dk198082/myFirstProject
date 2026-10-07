import { Fragment, useState } from 'react';
import * as C from '../../components/ui/hover-card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function HoverCardDemo(){return <C.HoverCard openDelay={150}><C.HoverCardTrigger asChild><Button variant="link">Hover or focus for details</Button></C.HoverCardTrigger><C.HoverCardContent side="bottom" align="start"><p className="text-sm font-semibold">Supporting information</p><p className="mt-2 text-xs text-muted-foreground">Non-modal source hover card.</p></C.HoverCardContent></C.HoverCard>; }
