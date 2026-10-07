import { Fragment, useState } from 'react';
import * as C from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function TableDemo() { return <C.Table><C.TableCaption>Illustrative component data; not live work orders.</C.TableCaption><C.TableHeader><C.TableRow><C.TableHead>Reference</C.TableHead><C.TableHead>Status</C.TableHead><C.TableHead className="text-right">Quantity</C.TableHead></C.TableRow></C.TableHeader><C.TableBody><C.TableRow><C.TableCell>EXAMPLE-01</C.TableCell><C.TableCell>Scheduled</C.TableCell><C.TableCell className="text-right">12</C.TableCell></C.TableRow><C.TableRow data-state="selected"><C.TableCell>EXAMPLE-02</C.TableCell><C.TableCell>Selected row</C.TableCell><C.TableCell className="text-right">8</C.TableCell></C.TableRow></C.TableBody><C.TableFooter><C.TableRow><C.TableCell colSpan={2}>Example total</C.TableCell><C.TableCell className="text-right">20</C.TableCell></C.TableRow></C.TableFooter></C.Table>; }
