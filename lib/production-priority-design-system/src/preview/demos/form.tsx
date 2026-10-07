import { Fragment, useState } from 'react';
import * as C from '../../components/ui/form';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

import { useForm } from 'react-hook-form';
export function FormDemo(){const form=useForm<{reference:string}>({defaultValues:{reference:''}});const [result,setResult]=useState('Not submitted');return <C.Form {...form}><form onSubmit={form.handleSubmit(values=>setResult('Submitted: '+values.reference))} className="max-w-md space-y-4"><C.FormField control={form.control} name="reference" rules={{required:'Reference is required.'}} render={({field})=><C.FormItem><C.FormLabel>Reference</C.FormLabel><C.FormControl><Input placeholder="Enter a reference" {...field}/></C.FormControl><C.FormDescription>Illustrative form; no data is sent to the server.</C.FormDescription><C.FormMessage/></C.FormItem>}/><Button type="submit">Submit example</Button><Button type="button" variant="outline" className="ml-2" onClick={()=>{form.reset();setResult('Not submitted');}}>Reset</Button><p role="status" className="text-sm">{result}</p></form></C.Form>; }
