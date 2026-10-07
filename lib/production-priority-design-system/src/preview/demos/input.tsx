import { Input } from '../../components/ui/input';
import { Stack } from '../parts';

export function InputDemo() {
  return (
    <div className="max-w-md space-y-6 rounded-xl border bg-card p-6">
      <Stack label="Types">
        <Input placeholder="Work order" aria-label="Work order" />
        <Input type="email" placeholder="name@example.com" aria-label="Email" />
        <Input type="number" defaultValue={4} min={1} aria-label="Weeks" />
        <Input type="date" aria-label="Build date" />
        <Input type="file" aria-label="Upload file" />
      </Stack>
      <Stack label="States">
        <Input defaultValue="Read only" readOnly aria-label="Read only input" />
        <Input placeholder="Disabled" disabled aria-label="Disabled input" />
        <Input placeholder="Invalid" aria-invalid="true" aria-label="Invalid input" />
      </Stack>
    </div>
  );
}
