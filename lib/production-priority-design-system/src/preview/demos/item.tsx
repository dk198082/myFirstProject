import { Fragment, useState } from 'react';
import * as C from '../../components/ui/item';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function ItemDemo(){return <C.ItemGroup>{(['default','outline','muted'] as const).map((variant,index)=><Fragment key={variant}><C.Item variant={variant} size={index===1?'sm':'default'}><C.ItemHeader><C.ItemTitle>{variant} item</C.ItemTitle></C.ItemHeader><C.ItemMedia variant={index===1?'icon':'default'}><InfoIcon className="size-4"/></C.ItemMedia><C.ItemContent><C.ItemDescription>Reusable item content.</C.ItemDescription></C.ItemContent><C.ItemActions><Button variant="outline" size="sm">Action</Button></C.ItemActions><C.ItemFooter><span className="text-xs text-muted-foreground">Footer</span></C.ItemFooter></C.Item><C.ItemSeparator/></Fragment>)}<C.Item asChild variant="outline"><a href="#page=overview"><C.ItemMedia variant="image"><span className="h-full w-full bg-primary" role="img" aria-label="Illustrative media"/></C.ItemMedia><C.ItemContent><C.ItemTitle>Linked item</C.ItemTitle><C.ItemDescription>As-child anchor with image media.</C.ItemDescription></C.ItemContent></a></C.Item></C.ItemGroup>; }
