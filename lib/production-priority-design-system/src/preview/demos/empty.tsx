import { Fragment, useState } from 'react';
import * as C from '../../components/ui/empty';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function EmptyDemo() {return <C.Empty className="max-w-lg border"><C.EmptyHeader><C.EmptyMedia variant="icon"><InfoIcon/></C.EmptyMedia><C.EmptyTitle>No results</C.EmptyTitle><C.EmptyDescription>There are no example items matching this filter.</C.EmptyDescription></C.EmptyHeader><C.EmptyContent><Button variant="outline">Clear filter</Button><C.EmptyMedia variant="default">Default media</C.EmptyMedia></C.EmptyContent></C.Empty>; }
