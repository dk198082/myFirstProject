import { useState } from "react";
import {
  useCreateWbScheduleBlock,
  useCreateWbPlaceholderJob,
  getListWbScheduleBlocksQueryKey,
  getListWbPlaceholderJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Car, Sun, Pencil, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ServiceLocationPicker } from "@/components/ServiceLocationPicker";

type EntryType = "drive_time" | "pto" | "custom" | "potential_job";

interface ServiceLocationValue {
  id: string;
  service_loc_id: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AddBlockDialog({
  technicianId,
  technicianName,
  date,
  onClose,
}: {
  technicianId: string;
  technicianName: string;
  /** ISO date string "YYYY-MM-DD" */
  date: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [entryType, setEntryType] = useState<EntryType>("potential_job");
  const [customTitle, setCustomTitle] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [serviceLocation, setServiceLocation] = useState<ServiceLocationValue | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [city, setCity] = useState("");
  const [state, setStateVal] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [startTime, setStartTime] = useState(`${date}T09:00`);
  const [endTime, setEndTime] = useState(entryType === "potential_job" ? `${date}T11:00` : `${date}T17:00`);
  const [notes, setNotes] = useState("");

  const blockLabel =
    entryType === "drive_time"
      ? "Drive time"
      : entryType === "pto"
        ? "PTO"
        : entryType === "potential_job"
          ? jobTitle.trim() || "Potential job"
          : customTitle.trim() || "Custom block";

  const invalidateBlocks = () =>
    queryClient.invalidateQueries({ queryKey: getListWbScheduleBlocksQueryKey() });
  const invalidatePlaceholders = () =>
    queryClient.invalidateQueries({ queryKey: getListWbPlaceholderJobsQueryKey() });

  const createBlockMutation = useCreateWbScheduleBlock({
    mutation: {
      onSuccess: () => {
        toast({
          title: `${blockLabel} added`,
          description: `Block added for ${technicianName}.`,
        });
        invalidateBlocks();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to add block",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const createPlaceholderMutation = useCreateWbPlaceholderJob({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Potential job added",
          description: `Added for ${technicianName}.`,
        });
        invalidatePlaceholders();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to add potential job",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const isPending = createBlockMutation.isPending || createPlaceholderMutation.isPending;

  const handleLocationChange = (loc: ServiceLocationValue | null) => {
    setServiceLocation(loc);
    if (loc) {
      setCustomerName(loc.name ?? "");
      setCity(loc.city ?? "");
      setStateVal(loc.state ?? "");
    }
  };

  const submit = () => {
    if (entryType === "custom" && !customTitle.trim()) {
      toast({ title: "Title required", description: "Please enter a title for the custom block.", variant: "destructive" });
      return;
    }
    if (entryType === "potential_job" && !jobTitle.trim()) {
      toast({ title: "Title required", description: "Please enter a job title.", variant: "destructive" });
      return;
    }
    const start = fromLocalInput(startTime);
    const end = fromLocalInput(endTime);
    if (!start || !end) {
      toast({ title: "Invalid times", description: "Please enter valid start and end times.", variant: "destructive" });
      return;
    }

    if (entryType === "potential_job") {
      createPlaceholderMutation.mutate({
        data: {
          technician_id: technicianId,
          title: jobTitle.trim(),
          customer_name: customerName.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          service_location_id: serviceLocation?.id ?? null,
          start_time: start,
          end_time: end,
          notes: notes.trim() || null,
          status: (jobStatus || null) as Parameters<typeof createPlaceholderMutation.mutate>[0]["data"]["status"],
        },
      });
      return;
    }

    createBlockMutation.mutate({
      data: {
        technician_id: technicianId,
        block_type: entryType,
        title: entryType === "custom" ? customTitle.trim() : null,
        start_time: start,
        end_time: end,
        notes: notes.trim() || null,
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add</DialogTitle>
          <DialogDescription>{technicianName} · {date}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0 overflow-y-auto flex-1 pr-1">
          {/* Entry type toggle */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEntryType("potential_job")}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  entryType === "potential_job"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-background text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <User className="h-4 w-4" />
                Potential Job
              </button>
              <button
                type="button"
                onClick={() => setEntryType("drive_time")}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  entryType === "drive_time"
                    ? "bg-slate-700 text-white border-slate-700"
                    : "bg-background text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <Car className="h-4 w-4" />
                Drive Time
              </button>
              <button
                type="button"
                onClick={() => setEntryType("pto")}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  entryType === "pto"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-background text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <Sun className="h-4 w-4" />
                PTO
              </button>
              <button
                type="button"
                onClick={() => setEntryType("custom")}
                className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  entryType === "custom"
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-background text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <Pencil className="h-4 w-4" />
                Custom
              </button>
            </div>
          </div>

          {/* Custom title — only shown for custom blocks */}
          {entryType === "custom" && (
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="block-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="block-title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="e.g. Training, Meeting, Sick leave"
                className="w-full min-w-0"
                autoFocus
              />
            </div>
          )}

          {/* Potential job fields */}
          {entryType === "potential_job" && (
            <>
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="ph-title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ph-title"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="e.g. Furnace install"
                  className="w-full min-w-0"
                  autoFocus
                />
              </div>

              <div className="relative">
                <ServiceLocationPicker
                  label="Service location"
                  value={serviceLocation}
                  onChange={handleLocationChange}
                />
              </div>

              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="ph-customer">Customer name</Label>
                <Input
                  id="ph-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  className="w-full min-w-0"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="ph-city">City</Label>
                  <Input
                    id="ph-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Austin"
                    className="w-full min-w-0"
                  />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label htmlFor="ph-state">State</Label>
                  <Input
                    id="ph-state"
                    value={state}
                    onChange={(e) => setStateVal(e.target.value)}
                    placeholder="e.g. TX"
                    className="w-full min-w-0"
                  />
                </div>
              </div>

              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="ph-status">Status <span className="text-muted-foreground">(optional)</span></Label>
                <Select value={jobStatus} onValueChange={setJobStatus}>
                  <SelectTrigger id="ph-status" className="w-full">
                    <SelectValue placeholder="Select a status…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Reminder Letter Sent">Reminder Letter Sent</SelectItem>
                    <SelectItem value="Quoted – No Purchase Order">Quoted – No Purchase Order</SelectItem>
                    <SelectItem value="Have Purchase Order">Have Purchase Order</SelectItem>
                    <SelectItem value="Have Credit Card">Have Credit Card</SelectItem>
                    <SelectItem value="Cash in Advance">Cash in Advance</SelectItem>
                    <SelectItem value="Credit Hold">Credit Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="block-start">Start time</Label>
            <Input
              id="block-start"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="block-end">End time</Label>
            <Input
              id="block-end"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="block-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="block-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Airport pickup, vacation"
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-row flex-wrap justify-end sm:space-x-0 shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
