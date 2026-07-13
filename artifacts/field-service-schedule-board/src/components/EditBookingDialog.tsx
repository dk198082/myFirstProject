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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, ExternalLink, CloudUpload, CalendarIcon } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const UNASSIGNED = "__unassigned__";

// "YYYY-MM-DDTHH:mm" (local) ↔ ISO helpers
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

// Parse "YYYY-MM-DDTHH:mm" → { datePart, hours24, minutes }
function parseLocal(local: string) {
  const datePart = local.slice(0, 10);
  const timePart = local.slice(11);
  const hours24 = timePart ? parseInt(timePart.slice(0, 2), 10) : 8;
  const minutes = timePart ? parseInt(timePart.slice(3, 5), 10) : 0;
  return { datePart, hours24, minutes };
}

function buildLocal(datePart: string, hours24: number, minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${datePart}T${pad(hours24)}:${pad(minutes)}`;
}

const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function DateTimePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [calOpen, setCalOpen] = useState(false);

  const { datePart, hours24, minutes } = parseLocal(value);

  const isPM = hours24 >= 12;
  const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;

  // The Date object for the calendar (parse date-only part so no TZ shift)
  const selectedDate = datePart
    ? new Date(datePart + "T00:00:00")
    : undefined;

  const handleDateSelect = (d: Date | undefined) => {
    if (!d) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const newDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    onChange(buildLocal(newDate, hours24, minutes));
    setCalOpen(false);
  };

  const handleHour = (h: string) => {
    const raw = parseInt(h, 10);
    const new24 = isPM ? (raw === 12 ? 12 : raw + 12) : raw === 12 ? 0 : raw;
    onChange(buildLocal(datePart || todayISO(), new24, minutes));
  };

  const handleMinute = (m: string) => {
    onChange(buildLocal(datePart || todayISO(), hours24, parseInt(m, 10)));
  };

  const handleAmPm = (v: string) => {
    const wantPM = v === "PM";
    let new24 = hours24;
    if (wantPM && !isPM) new24 = hours24 === 0 ? 12 : hours24 + 12;
    if (!wantPM && isPM) new24 = hours24 === 12 ? 0 : hours24 - 12;
    onChange(buildLocal(datePart || todayISO(), new24, minutes));
  };

  const dateLabel = selectedDate
    ? format(selectedDate, "EEE, MMM d, yyyy")
    : "Pick a date";

  return (
    <div className="space-y-2">
      {/* Date picker */}
      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className="w-full justify-start gap-2 font-normal"
          >
            <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className={!selectedDate ? "text-muted-foreground" : ""}>
              {dateLabel}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            captionLayout="dropdown"
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {/* Time picker */}
      <div className="flex gap-2">
        {/* Hour */}
        <Select value={String(hours12)} onValueChange={handleHour}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Minute */}
        <Select
          value={String(MINUTE_OPTIONS.includes(minutes) ? minutes : 0)}
          onValueChange={handleMinute}
        >
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MINUTE_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {String(m).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* AM / PM */}
        <Select value={isPM ? "PM" : "AM"} onValueChange={handleAmPm}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  onSaveSuccess?: (bookingId: string | null) => void;
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
        onSaveSuccess?.(row.booking_id ?? null);
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
        onSaveSuccess?.(null);
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
            <Label htmlFor="start">Start</Label>
            <DateTimePicker id="start" value={start} onChange={onStartChange} />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="end">End</Label>
            <DateTimePicker id="end" value={end} onChange={setEnd} />
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
