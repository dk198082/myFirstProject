import { Fragment, useState } from 'react';
import * as C from '../../components/ui/carousel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function CarouselDemo() {return <Stack>{(['horizontal','vertical'] as const).map(orientation=><div key={orientation} className="m-12 max-w-md"><C.Carousel orientation={orientation} opts={{loop:false}}><C.CarouselContent className={orientation==='vertical'?'h-40':''}>{[1,2,3].map(n=><C.CarouselItem key={n} className={orientation==='vertical'?'basis-full':''}><div className="flex h-36 items-center justify-center rounded-sm border bg-card text-xl font-bold">Example {n}</div></C.CarouselItem>)}</C.CarouselContent><C.CarouselPrevious/><C.CarouselNext/></C.Carousel></div>)}</Stack>; }
