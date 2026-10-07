import { Fragment, useState } from 'react';
import * as C from '../../components/ui/toast';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

import { Toaster } from '../../components/ui/toaster';
import { useToast } from '../../hooks/use-toast';
export function ToastDemo() { const {toast,dismiss}=useToast(); return <><Row label="Notifications"><Button onClick={()=>toast({title:'Preview saved',description:'A demonstration notification.',duration:4000,action:<C.ToastAction altText="Undo preview action">Undo</C.ToastAction>})}>Show toast</Button><Button variant="destructive" onClick={()=>toast({title:'Preview warning',description:'No application data was changed.',variant:'destructive',duration:4000})}>Show destructive toast</Button><Button variant="outline" onClick={()=>dismiss()}>Dismiss notifications</Button></Row><Toaster /></>; }
