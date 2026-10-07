import { Fragment, useState } from 'react';
import * as C from '../../components/ui/input-otp';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { InfoIcon, PlusIcon, ChevronRightIcon } from 'lucide-react';
import { Row, Stack } from '../parts';

export function InputOtpDemo(){const [code,setCode]=useState('');const slots=<><C.InputOTPGroup>{[0,1,2].map(index=><C.InputOTPSlot key={index} index={index}/>)}</C.InputOTPGroup><C.InputOTPSeparator/><C.InputOTPGroup>{[3,4,5].map(index=><C.InputOTPSlot key={index} index={index}/>)}</C.InputOTPGroup></>;return <Stack><C.InputOTP maxLength={6} value={code} onChange={setCode} aria-label="Example verification code">{slots}</C.InputOTP><p className="text-xs">Entered: {code||'None'}</p><C.InputOTP maxLength={6} disabled value="123456" aria-label="Disabled code">{slots}</C.InputOTP></Stack>; }
