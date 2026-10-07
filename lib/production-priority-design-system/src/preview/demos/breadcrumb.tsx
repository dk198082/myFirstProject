import { Fragment, useState } from 'react';
import * as C from '../../components/ui/breadcrumb';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function BreadcrumbDemo() {return <C.Breadcrumb><C.BreadcrumbList><C.BreadcrumbItem><C.BreadcrumbLink href="#page=overview">Overview</C.BreadcrumbLink></C.BreadcrumbItem><C.BreadcrumbSeparator/><C.BreadcrumbItem><C.BreadcrumbEllipsis/></C.BreadcrumbItem><C.BreadcrumbSeparator><ChevronRightIcon className="h-4 w-4" /></C.BreadcrumbSeparator><C.BreadcrumbItem><C.BreadcrumbLink asChild><a href="#page=color-roles">Colors</a></C.BreadcrumbLink></C.BreadcrumbItem><C.BreadcrumbSeparator/><C.BreadcrumbItem><C.BreadcrumbPage>Current page</C.BreadcrumbPage></C.BreadcrumbItem></C.BreadcrumbList></C.Breadcrumb>; }
