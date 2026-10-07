import { Fragment, useState } from 'react';
import * as C from '../../components/ui/toggle';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ToggleDemo() { const [pressed,setPressed]=useState(false); return <Stack><Row label="Variants and sizes">{(['default','outline'] as const).map(variant=>(['default','sm','lg'] as const).map(size=><C.Toggle key={variant+size} variant={variant} size={size} aria-label={variant+' '+size}>{variant} / {size}</C.Toggle>))}</Row><Row label="States"><C.Toggle pressed={pressed} onPressedChange={setPressed}>Controlled: {pressed?'on':'off'}</C.Toggle><C.Toggle defaultPressed>Initially pressed</C.Toggle><C.Toggle disabled>Disabled</C.Toggle></Row></Stack>; }
