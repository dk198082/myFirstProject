import { Fragment, useState } from 'react';
import * as C from '../../components/ui/kbd';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function KbdDemo(){return <Row label="Key hints"><C.Kbd>Esc</C.Kbd><C.KbdGroup><C.Kbd>Ctrl</C.Kbd><span>+</span><C.Kbd>K</C.Kbd></C.KbdGroup></Row>; }
