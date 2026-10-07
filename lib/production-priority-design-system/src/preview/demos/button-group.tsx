import { Fragment, useState } from 'react';
import * as C from '../../components/ui/button-group';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ButtonGroupDemo() {return <Stack><Row label="Horizontal"><C.ButtonGroup orientation="horizontal"><C.ButtonGroupText>Queue</C.ButtonGroupText><Button variant="outline">Previous</Button><C.ButtonGroupSeparator/><Button variant="outline">Next</Button><Button disabled>Disabled</Button></C.ButtonGroup></Row><Row label="Vertical"><C.ButtonGroup orientation="vertical"><Button variant="outline">First</Button><C.ButtonGroupSeparator orientation="horizontal"/><Button variant="outline">Second</Button></C.ButtonGroup></Row><C.ButtonGroupText asChild><span>As-child group text</span></C.ButtonGroupText></Stack>; }
