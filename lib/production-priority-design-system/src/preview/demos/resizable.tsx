import { Fragment, useState } from 'react';
import * as C from '../../components/ui/resizable';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ResizableDemo(){return <Stack>{(['horizontal','vertical'] as const).map(direction=><C.ResizablePanelGroup key={direction} direction={direction} className="h-64 max-w-2xl rounded-sm border" style={{height:256}}><C.ResizablePanel defaultSize={40} minSize={20}><div className="flex h-full items-center justify-center p-4 text-sm">First panel</div></C.ResizablePanel><C.ResizableHandle withHandle/><C.ResizablePanel defaultSize={60} minSize={20}><div className="flex h-full items-center justify-center p-4 text-sm">Second panel</div></C.ResizablePanel></C.ResizablePanelGroup>)}</Stack>; }
