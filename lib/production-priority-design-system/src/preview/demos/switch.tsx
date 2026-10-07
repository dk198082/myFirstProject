import { Fragment, useState } from 'react';
import * as C from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function SwitchDemo(){const [checked,setChecked]=useState(false);return <Row label="Switch states"><div className="flex items-center gap-2"><C.Switch id="switch-controlled" checked={checked} onCheckedChange={setChecked}/><Label htmlFor="switch-controlled">Controlled: {checked?'on':'off'}</Label></div><div className="flex items-center gap-2"><C.Switch id="switch-uncontrolled" defaultChecked/><Label htmlFor="switch-uncontrolled">Initially on</Label></div><div className="flex items-center gap-2"><C.Switch id="switch-disabled" disabled/><Label htmlFor="switch-disabled">Disabled</Label></div></Row>; }
