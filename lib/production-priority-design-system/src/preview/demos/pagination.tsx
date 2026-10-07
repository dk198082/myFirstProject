import { Fragment, useState } from 'react';
import * as C from '../../components/ui/pagination';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function PaginationDemo(){const [page,setPage]=useState(2);return <Stack><C.Pagination><C.PaginationContent><C.PaginationItem><C.PaginationPrevious href="#" aria-disabled={page===1} onClick={e=>{e.preventDefault();setPage(p=>Math.max(1,p-1));}}/></C.PaginationItem>{[1,2,3].map(n=><C.PaginationItem key={n}><C.PaginationLink href="#" isActive={page===n} onClick={e=>{e.preventDefault();setPage(n);}}>{n}</C.PaginationLink></C.PaginationItem>)}<C.PaginationItem><C.PaginationEllipsis/></C.PaginationItem><C.PaginationItem><C.PaginationNext href="#" onClick={e=>{e.preventDefault();setPage(p=>Math.min(3,p+1));}}/></C.PaginationItem></C.PaginationContent></C.Pagination><Row label="Link sizes">{(['default','sm','lg','icon'] as const).map(size=><C.PaginationLink key={size} size={size} href="#" onClick={e=>e.preventDefault()} aria-label={size+' page link'}>{size==='icon'?1:size}</C.PaginationLink>)}</Row><p className="text-sm">Example page: {page}</p></Stack>; }
