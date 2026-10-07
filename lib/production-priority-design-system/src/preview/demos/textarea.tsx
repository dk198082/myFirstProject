import { Fragment, useState } from 'react';
import * as C from '../../components/ui/textarea';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function TextareaDemo() { const [text,setText]=useState(''); return <Stack label="Text areas"><Label htmlFor="textarea-note">Controlled note</Label><C.Textarea id="textarea-note" value={text} onChange={e=>setText(e.target.value)} placeholder="Enter a note" /><C.Textarea aria-label="Read only note" defaultValue="Read-only value" readOnly /><C.Textarea aria-label="Disabled note" disabled placeholder="Disabled" /><C.Textarea aria-label="Invalid note" aria-invalid="true" placeholder="Invalid state" /><p className="text-xs text-muted-foreground">Characters: {text.length}</p></Stack>; }
