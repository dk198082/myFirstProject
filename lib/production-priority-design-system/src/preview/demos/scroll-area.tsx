import { Fragment, useState } from 'react';
import * as C from '../../components/ui/scroll-area';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ScrollAreaDemo(){return <C.ScrollArea className="h-60 max-w-md rounded-sm border"><div className="min-w-[600px] space-y-3 p-4">{Array.from({length:20},(_,i)=><p key={i} className="border-b pb-2 text-sm">Illustrative row {i+1} — horizontal and vertical scrolling</p>)}</div><C.ScrollBar orientation="horizontal"/><C.ScrollBar orientation="vertical"/></C.ScrollArea>; }
