import { useMemo, useState } from "react";
import {
  useUpdateWbBooking,
  useListWbTechnicians,
  getListWbWorkOrdersQueryKey,
  getListWbWritebacksQueryKey,
  getGetWbScheduleBoardQueryKey,
  type WbWorkOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const UNASSIGNED = "__unassigned__";

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function EditBookingDialog({
  row,
  onClose,
}: {
  row: WbWorkOrder;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: technicians = [] } = useListWbTechnicians();
  const updateMutation = useUpdateWbBooking({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Write-back queued",
          description: `Edit staged locally for ${row.work_order_number ?? "booking"}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListWbWorkOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListWbWritebacksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWbScheduleBoardQueryKey() });
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to queue write-back",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const seed = row.pending_writeback ?? row;
  const [start, setStart] = useState(toLocalInput(seed.start_time));
  const [end, setEnd] = useState(toLocalInput(seed.end_time));
  const [techId, setTechId] = useState<string>(seed.technician_id ?? UNASSIGNED);

  const sortedTechs = useMemo(
    () =>
      [...technicians].sort((a, b) =>
        (a.resource_name ?? "").localeCompare(b.resource_name ?? ""),
      ),
    [technicians],
  );

  const submit = () => {
    if (!row.booking_id) return;
    updateMutation.mutate({
      bookingId: row.booking_id,
      data: {
        start_time: fromLocalInput(start),
        end_time: fromLocalInput(end),
        technician_id: techId === UNASSIGNED ? null : techId,
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            {row.work_order_number ?? "Work order"} · {row.title ?? "Untitled"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="start">Start time</Label>
            <Input
              id="start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end">End time</Label>
            <Input
              id="end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Technician</Label>
            <Select value={techId} onValueChange={setTechId}>
              <SelectTrigger>
                <SelectValue placeholder="Select technician" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {sortedTechs.map((t) => (
                  <SelectItem key={t.technician_id} value={t.technician_id}>
                    {t.resource_name ?? t.technician_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md bg-muted/60 border border-border px-3 py-2 text-xs text-muted-foreground">
            Edits are staged in the local <code className="font-mono">booking_writebacks</code> table.
            Nothing is pushed to Dynamics until a sync job runs.
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Queue write-back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
