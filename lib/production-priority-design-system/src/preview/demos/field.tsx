import { Fragment, useState } from 'react';
import * as C from '../../components/ui/field';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function FieldDemo(){return <C.FieldSet className="max-w-xl"><C.FieldLegend>Field grouping</C.FieldLegend><C.FieldDescription>Source field compositions with supporting text.</C.FieldDescription><C.FieldGroup>{(['vertical','horizontal','responsive'] as const).map(orientation=><C.Field key={orientation} orientation={orientation}><C.FieldContent><C.FieldLabel htmlFor={'field-'+orientation}>{orientation}</C.FieldLabel><C.FieldDescription>Label and input stay associated.</C.FieldDescription></C.FieldContent><Input id={'field-'+orientation} placeholder="Example value" /></C.Field>)}<C.FieldSeparator>Validation</C.FieldSeparator><C.Field data-invalid="true"><C.FieldTitle>Invalid field</C.FieldTitle><C.FieldLabel htmlFor="field-error">Reference</C.FieldLabel><Input id="field-error" aria-invalid="true" aria-describedby="field-error-description"/><C.FieldError id="field-error-description" errors={[{message:'A reference is required.'},{message:'Use a valid reference.'}]}/></C.Field><C.Field><C.FieldLabel htmlFor="field-disabled">Disabled</C.FieldLabel><Input id="field-disabled" disabled /></C.Field><C.FieldSet><C.FieldLegend variant="label">Label-size legend</C.FieldLegend><C.FieldDescription>Nested field set.</C.FieldDescription></C.FieldSet></C.FieldGroup></C.FieldSet>; }
