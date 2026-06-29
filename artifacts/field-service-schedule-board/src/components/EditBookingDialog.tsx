import { useMemo, useState } from "react";
import {
  useSaveWbBooking,
  useSaveNewWbBooking,
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
import { Loader2, ExternalLink, CloudUpload } from "lucide-react";
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
  onSaveSuccess,
}: {
  row: WbWorkOrder;
  durationMinutes?: number | null;
  onClose: () => void;
  /** Called when a direct-to-CRM save completes successfully, before the dialog closes. */
  onSaveSuccess?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: technicians = [] } = useListWbTechnicians();

  const isNew = !row.booking_id;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListWbWorkOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWbWritebacksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWbScheduleBoardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWbUnscheduledJobsQueryKey() });
  };

  // After a direct CRM save the mirror DB needs a moment to sync. Fire
  // additional refetches at 5 s, 12 s and 20 s so the board updates as soon
  // as the mirror picks up the change (without continuous polling overhead).
  const invalidateAllWithFollowUp = () => {
    invalidateAll();
    [5_000, 12_000, 20_000].forEach((ms) => setTimeout(invalidateAll, ms));
  };

  const saveMutation = useSaveWbBooking({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Saved to CRM",
          description: `${row.work_order_number ?? "Booking"} updated in Dynamics.`,
        });
        onSaveSuccess?.();
        invalidateAllWithFollowUp();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to save to CRM",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const saveNewMutation = useSaveNewWbBooking({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Booking created in CRM",
          description: `New booking for ${row.work_order_number ?? "work order"} saved to Dynamics.`,
        });
        onSaveSuccess?.();
        invalidateAllWithFollowUp();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to create booking in CRM",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const isPending = saveMutation.isPending || saveNewMutation.isPending;

  const seed = row.pending_writeback ?? row;
  const [start, setStart] = useState(toLocalInput(seed.start_time));
  const [end, setEnd] = useState(toLocalInput(seed.end_time));
  const [techId, setTechId] = useState<string>(seed.technician_id ?? UNASSIGNED);

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
      saveNewMutation.mutate({ workOrderId: row.work_order_id, data });
    } else {
      if (!row.booking_id) return;
      saveMutation.mutate({ bookingId: row.booking_id, data });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isNew ? "Schedule booking" : "Edit booking"}</DialogTitle>
          <DialogDescription>
            {row.work_order_number ?? "Work order"} · {row.title ?? "Untitled"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0 overflow-hidden">
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="start">Start time</Label>
            <Input
              id="start"
              type="datetime-local"
              value={start}
              onChange={(e) => onStartChange(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="end">End time</Label>
            <Input
              id="end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full min-w-0 block"
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

          {row.work_order_id && (
            <Link
              href={`/work-order/${row.work_order_id}`}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View work order details
            </Link>
          )}
        </div>

        <DialogFooter className="gap-2 flex-row flex-wrap justify-end sm:space-x-0">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <CloudUpload className="h-4 w-4 mr-1.5" />}
            {isNew ? "Create booking" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
