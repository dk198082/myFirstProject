import { Fragment, useState } from 'react';
import * as C from '../../components/ui/spinner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function SpinnerDemo(){return <Row label="Loading indicators"><C.Spinner/><C.Spinner className="size-6"/><Button disabled><C.Spinner/>Loading</Button></Row>; }
