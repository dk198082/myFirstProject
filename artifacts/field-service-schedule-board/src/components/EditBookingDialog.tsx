import { useMemo, useState } from "react";
import {
  useUpdateWbBooking,
  useCreateWbBooking,
  useListWbTechnicians,
  getListWbWorkOrdersQueryKey,
  getListWbWritebacksQueryKey,
  getGetWbScheduleBoardQueryKey,
  getGetWbUnscheduledJobsQueryKey,
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
import { Loader2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
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
  durationMinutes,
  onClose,
}: {
  row: WbWorkOrder;
  // Estimated job duration, used to auto-fill the end time when scheduling a new
  // booking for an unscheduled work order.
  durationMinutes?: number | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: technicians = [] } = useListWbTechnicians();

  // New-booking mode: an unscheduled work order has no booking yet, so we create
  // one rather than patching an existing booking.
  const isNew = !row.booking_id;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListWbWorkOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWbWritebacksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWbScheduleBoardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWbUnscheduledJobsQueryKey() });
  };

  const updateMutation = useUpdateWbBooking({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Write-back queued",
          description: `Edit staged locally for ${row.work_order_number ?? "booking"}.`,
        });
        invalidateAll();
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

  const createMutation = useCreateWbBooking({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Booking queued",
          description: `New booking staged locally for ${row.work_order_number ?? "work order"}.`,
        });
        invalidateAll();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to queue booking",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const isPending = updateMutation.isPending || createMutation.isPending;

  const seed = row.pending_writeback ?? row;
  const [start, setStart] = useState(toLocalInput(seed.start_time));
  const [end, setEnd] = useState(toLocalInput(seed.end_time));
  const [techId, setTechId] = useState<string>(seed.technician_id ?? UNASSIGNED);

  // When scheduling a new booking, auto-fill the end time from the estimated
  // duration as soon as the user picks a start (unless they've set one already).
  const onStartChange = (value: string) => {
    setStart(value);
    if (isNew && durationMinutes && durationMinutes > 0 && !end && value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        d.setMinutes(d.getMinutes() + durationMinutes);
        setEnd(toLocalInput(d.toISOString()));
      }
    }
  };

  const sortedTechs = useMemo(
    () =>
      [...technicians].sort((a, b) =>
        (a.resource_name ?? "").localeCompare(b.resource_name ?? ""),
      ),
    [technicians],
  );

  const submit = () => {
    const data = {
      start_time: fromLocalInput(start),
      end_time: fromLocalInput(end),
      technician_id: techId === UNASSIGNED ? null : techId,
    };
    if (isNew) {
      if (!row.work_order_id) return;
      createMutation.mutate({ workOrderId: row.work_order_id, data });
    } else {
      if (!row.booking_id) return;
      updateMutation.mutate({ bookingId: row.booking_id, data });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Schedule booking" : "Edit booking"}</DialogTitle>
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
              onChange={(e) => onStartChange(e.target.value)}
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
            {isNew ? (
              <>
                A new booking is staged in the local{" "}
                <code className="font-mono">booking_writebacks</code> queue. Nothing is created in
                Dynamics until a sync job runs.
              </>
            ) : (
              <>
                Edits are staged in the local{" "}
                <code className="font-mono">booking_writebacks</code> table. Nothing is pushed to
                Dynamics until a sync job runs.
              </>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {row.work_order_id ? (
            <Button variant="outline" asChild>
              <Link
                href={`/work-order/${row.work_order_id}`}
                onClick={onClose}
                className="inline-flex items-center gap-1.5"
              >
                <ExternalLink className="h-4 w-4" />
                View work order details
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {isNew ? "Queue booking" : "Queue write-back"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
