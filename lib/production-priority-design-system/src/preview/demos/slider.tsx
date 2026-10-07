import { Fragment, useState } from 'react';
import * as C from '../../components/ui/slider';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function SliderDemo(){const [values,setValues]=useState([40]);return <Stack><C.Slider aria-label="Controlled quantity" value={values} onValueChange={setValues} max={100} step={5}/><p className="text-xs">Value: {values[0]}</p><C.Slider aria-label="Range example" defaultValue={[20,70]} max={100}/><C.Slider aria-label="Disabled slider" defaultValue={[50]} disabled/><C.Slider aria-label="Vertical slider" orientation="vertical" defaultValue={[35]} className="h-36" /></Stack>; }
