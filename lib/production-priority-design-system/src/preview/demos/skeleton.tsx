import { Fragment, useState } from 'react';
import * as C from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function SkeletonDemo() { return <Stack label="Loading placeholders"><div className="flex max-w-sm items-center gap-3"><C.Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><C.Skeleton className="h-4 w-3/4" /><C.Skeleton className="h-3 w-full" /></div></div><C.Skeleton className="h-28 max-w-md" /></Stack>; }
