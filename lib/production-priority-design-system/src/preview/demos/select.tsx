import { Fragment, useState } from 'react';
import * as C from '../../components/ui/select';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function SelectDemo(){const [value,setValue]=useState('');return <Stack><C.Select value={value} onValueChange={setValue}><C.SelectTrigger className="w-64" aria-label="Production group"><C.SelectValue placeholder="Choose a group"/></C.SelectTrigger><C.SelectContent><C.SelectGroup><C.SelectLabel>Example groups</C.SelectLabel><C.SelectItem value="horizontal">Horizontal</C.SelectItem><C.SelectItem value="vertical">Vertical</C.SelectItem></C.SelectGroup><C.SelectSeparator/><C.SelectGroup><C.SelectLabel>Unavailable</C.SelectLabel><C.SelectItem disabled value="disabled">Disabled option</C.SelectItem></C.SelectGroup></C.SelectContent></C.Select><C.Select disabled><C.SelectTrigger className="w-64" aria-label="Disabled select"><C.SelectValue placeholder="Disabled select"/></C.SelectTrigger><C.SelectContent><C.SelectItem value="one">One</C.SelectItem></C.SelectContent></C.Select><p className="text-xs">Selected: {value||'None'}</p></Stack>; }
