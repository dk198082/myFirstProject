import { Fragment, useState } from 'react';
import * as C from '../../components/ui/sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

import { toast } from 'sonner';
export function SonnerDemo(){return <><Row label="Notifications"><Button onClick={()=>toast('Example notification',{description:'Source Sonner notification.'})}>Message</Button><Button onClick={()=>toast.success('Example success')}>Success</Button><Button variant="destructive" onClick={()=>toast.error('Example error')}>Error</Button><Button variant="outline" onClick={()=>toast('Example action',{action:{label:'Undo',onClick:()=>toast('Example undone')}})}>Action</Button><Button variant="outline" onClick={()=>toast.dismiss()}>Dismiss</Button></Row><C.Toaster /></>; }
