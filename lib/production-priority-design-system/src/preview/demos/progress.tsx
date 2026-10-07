import { Fragment, useState } from 'react';
import * as C from '../../components/ui/progress';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ProgressDemo(){const [value,setValue]=useState(40);return <Stack><Label htmlFor="progress-range">Controlled progress: {value}%</Label><input id="progress-range" type="range" value={value} min={0} max={100} onChange={e=>setValue(Number(e.target.value))}/><C.Progress value={value} aria-label="Controlled progress"/>{[0,50,100].map(n=><div key={n}><p className="mb-2 text-xs">{n}%</p><C.Progress value={n} aria-label={n+' percent'}/></div>)}</Stack>; }
