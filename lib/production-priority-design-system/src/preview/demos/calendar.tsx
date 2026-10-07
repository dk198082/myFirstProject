import { Fragment, useState } from 'react';
import * as C from '../../components/ui/calendar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

import type { DateRange } from 'react-day-picker';
export function CalendarDemo() {const [date,setDate]=useState<Date|undefined>(new Date(2026,9,6));const [range,setRange]=useState<DateRange|undefined>({from:new Date(2026,9,6),to:new Date(2026,9,10)});const [dates,setDates]=useState<Date[]|undefined>([]);return <Stack><Row label="Single date / disabled weekends"><C.Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={new Date(2026,9,1)} disabled={{dayOfWeek:[0,6]}} captionLayout="dropdown" buttonVariant="outline" /></Row><Row label="Date range"><C.Calendar mode="range" selected={range} onSelect={setRange} defaultMonth={new Date(2026,9,1)} numberOfMonths={2}/></Row><Row label="Multiple dates"><C.Calendar mode="multiple" selected={dates} onSelect={setDates} defaultMonth={new Date(2026,9,1)} showOutsideDays={false}/></Row><p className="text-xs text-muted-foreground">Selected: {date?.toLocaleDateString()??'None'}</p></Stack>; }
