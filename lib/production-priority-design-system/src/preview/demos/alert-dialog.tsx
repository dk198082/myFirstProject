import { Fragment, useState } from 'react';
import * as C from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function AlertDialogDemo() { const [result,setResult]=useState('No action taken');return <Stack><C.AlertDialog><C.AlertDialogTrigger asChild><Button variant="outline">Open confirmation</Button></C.AlertDialogTrigger><C.AlertDialogContent><C.AlertDialogHeader><C.AlertDialogTitle>Confirm preview action?</C.AlertDialogTitle><C.AlertDialogDescription>This only changes the text on this documentation page.</C.AlertDialogDescription></C.AlertDialogHeader><C.AlertDialogFooter><C.AlertDialogCancel>Cancel</C.AlertDialogCancel><C.AlertDialogAction onClick={()=>setResult('Preview action confirmed')}>Confirm</C.AlertDialogAction></C.AlertDialogFooter></C.AlertDialogContent></C.AlertDialog><p role="status" className="text-sm">{result}</p></Stack>; }
