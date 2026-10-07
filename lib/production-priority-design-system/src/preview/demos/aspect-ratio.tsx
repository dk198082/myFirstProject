import { Fragment, useState } from 'react';
import * as C from '../../components/ui/aspect-ratio';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function AspectRatioDemo() {return <div className="grid max-w-2xl gap-4 sm:grid-cols-2">{[16/9,1].map(ratio=><C.AspectRatio key={ratio} ratio={ratio} className="flex items-center justify-center rounded-sm border bg-muted"><span className="text-sm">{ratio===1?'1 : 1':'16 : 9'}</span></C.AspectRatio>)}</div>; }
