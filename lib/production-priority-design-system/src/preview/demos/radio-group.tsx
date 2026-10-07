import { Fragment, useState } from 'react';
import * as C from '../../components/ui/radio-group';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function RadioGroupDemo(){const [value,setValue]=useState('queue');return <Stack><C.RadioGroup value={value} onValueChange={setValue} aria-label="Example view">{['queue','schedule','disabled'].map(option=><div key={option} className="flex items-center gap-2"><C.RadioGroupItem id={'radio-'+option} value={option} disabled={option==='disabled'}/><Label htmlFor={'radio-'+option}>{option}</Label></div>)}</C.RadioGroup><C.RadioGroup defaultValue="one" orientation="horizontal" className="flex gap-4" aria-label="Uncontrolled example">{['one','two'].map(option=><div key={option} className="flex gap-2"><C.RadioGroupItem value={option} id={'radio-horizontal-'+option}/><Label htmlFor={'radio-horizontal-'+option}>{option}</Label></div>)}</C.RadioGroup><p className="text-xs">Selected: {value}</p></Stack>; }
