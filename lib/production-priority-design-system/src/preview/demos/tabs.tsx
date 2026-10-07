import { Fragment, useState } from 'react';
import * as C from '../../components/ui/tabs';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function TabsDemo() { const [tab,setTab]=useState('queue'); return <C.Tabs value={tab} onValueChange={setTab} className="max-w-md"><C.TabsList><C.TabsTrigger value="queue">Queue</C.TabsTrigger><C.TabsTrigger value="schedule">Schedule</C.TabsTrigger><C.TabsTrigger value="disabled" disabled>Disabled</C.TabsTrigger></C.TabsList><C.TabsContent value="queue">Queue panel</C.TabsContent><C.TabsContent value="schedule">Schedule panel</C.TabsContent></C.Tabs>; }
