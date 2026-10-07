import { Fragment, useState } from 'react';
import * as C from '../../components/ui/navigation-menu';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function NavigationMenuDemo(){return <C.NavigationMenu><C.NavigationMenuList><C.NavigationMenuItem><C.NavigationMenuTrigger>Documentation</C.NavigationMenuTrigger><C.NavigationMenuContent><ul className="w-64 space-y-2 p-4"><li><C.NavigationMenuLink asChild><a href="#page=overview" className="block p-2 text-sm">Overview</a></C.NavigationMenuLink></li><li><C.NavigationMenuLink asChild><a href="#page=color-roles" className="block p-2 text-sm">Colors</a></C.NavigationMenuLink></li></ul></C.NavigationMenuContent></C.NavigationMenuItem><C.NavigationMenuItem><C.NavigationMenuLink href="#page=component-button" active className={C.navigationMenuTriggerStyle()}>Active link</C.NavigationMenuLink></C.NavigationMenuItem><C.NavigationMenuItem><C.NavigationMenuTrigger disabled>Disabled</C.NavigationMenuTrigger></C.NavigationMenuItem></C.NavigationMenuList><C.NavigationMenuIndicator/></C.NavigationMenu>; }
