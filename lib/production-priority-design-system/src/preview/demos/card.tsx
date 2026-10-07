import { Fragment, useState } from 'react';
import * as C from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function CardDemo() { return <C.Card className="max-w-md"><C.CardHeader><C.CardTitle>Work order</C.CardTitle><C.CardDescription>Reusable bordered information surface.</C.CardDescription></C.CardHeader><C.CardContent><Label htmlFor="card-filter">Reference</Label><Input id="card-filter" placeholder="Order reference" className="mt-2" /></C.CardContent><C.CardFooter className="gap-2"><Button>Primary action</Button><Button variant="outline" disabled>Disabled</Button></C.CardFooter></C.Card>; }
