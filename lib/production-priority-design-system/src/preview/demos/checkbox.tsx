import { Fragment, useState } from 'react';
import * as C from '../../components/ui/checkbox';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function CheckboxDemo() {const [checked,setChecked]=useState<boolean|'indeterminate'>(false);return <Row label="Checkbox states"><div className="flex items-center gap-2"><C.Checkbox id="checkbox-controlled" checked={checked} onCheckedChange={setChecked}/><Label htmlFor="checkbox-controlled">Controlled</Label></div><div className="flex items-center gap-2"><C.Checkbox id="checkbox-mixed" checked="indeterminate"/><Label htmlFor="checkbox-mixed">Mixed</Label></div><div className="flex items-center gap-2"><C.Checkbox id="checkbox-disabled" defaultChecked disabled/><Label htmlFor="checkbox-disabled">Disabled / checked</Label></div></Row>; }
