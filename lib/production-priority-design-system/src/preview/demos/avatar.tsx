import { Fragment, useState } from 'react';
import * as C from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

const avatarImage='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="%2313392f"/%3E%3Ccircle cx="40" cy="30" r="13" fill="%23b7ff00"/%3E%3Cpath d="M16 76v-12a24 24 0 0 1 48 0v12" fill="%23b7ff00"/%3E%3C/svg%3E';
export function AvatarDemo() {return <Row label="Image and fallback"><C.Avatar><C.AvatarImage src={avatarImage} alt="Illustrative avatar" /><C.AvatarFallback>AB</C.AvatarFallback></C.Avatar><C.Avatar><C.AvatarImage src="data:image/png;base64,invalid" alt="Unavailable avatar" /><C.AvatarFallback>CD</C.AvatarFallback></C.Avatar><C.Avatar className="h-12 w-12"><C.AvatarFallback>EF</C.AvatarFallback></C.Avatar></Row>; }
