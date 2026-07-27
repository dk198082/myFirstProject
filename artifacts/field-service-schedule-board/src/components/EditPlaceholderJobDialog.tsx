import { useState } from "react";
import {
  useUpdateWbPlaceholderJob,
  useDeleteWbPlaceholderJob,
  useGetWbServiceLocation,
  getListWbPlaceholderJobsQueryKey,
  getGetWbServiceLocationQueryKey,
  type PlaceholderJob,
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
import { Loader2, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ServiceLocationPicker } from "@/components/ServiceLocationPicker";
import { ChipColorPicker } from "@/components/ChipColorPicker";

interface ServiceLocationValue {
  id: string;
  service_loc_id: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
}

function toLocalInput(iso: string): string {
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

export function EditPlaceholderJobDialog({
  job,
  technicianName,
  defaultColorIndex = null,
  onClose,
}: {
  job: PlaceholderJob;
  technicianName: string;
  /** Palette index to pre-select when job has no saved colour override. */
  defaultColorIndex?: number | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [serviceLocation, setServiceLocation] = useState<ServiceLocationValue | null>(
    // Initialize from service_location_id alone; customer_name may be blank but
    // the ID must be preserved so saves don't accidentally unlink CRM jobs.
    job.service_location_id
      ? { id: job.service_location_id, service_loc_id: null, name: job.customer_name ?? null, city: job.city ?? null, state: job.state ?? null }
      : null,
  );
  const [customerName, setCustomerName] = useState(job.customer_name ?? "");
  const [city, setCity] = useState(job.city ?? "");
  const [state, setStateVal] = useState(job.state ?? "");
  const [jobStatus, setJobStatus] = useState(job.status ?? "");
  const [startTime, setStartTime] = useState(toLocalInput(job.start_time));
  const [endTime, setEndTime] = useState(toLocalInput(job.end_time));
  const [notes, setNotes] = useState(job.notes ?? "");
  const [colorIndex, setColorIndex] = useState<number | null>(job.color_index ?? defaultColorIndex);

  const { data: locDetail } = useGetWbServiceLocation(
    job.service_location_id ?? "",
    {
      query: {
        queryKey: getGetWbServiceLocationQueryKey(job.service_location_id ?? ""),
        enabled: !!job.service_location_id,
        staleTime: 5 * 60_000,
      },
    },
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListWbPlaceholderJobsQueryKey() });

  const updateMutation = useUpdateWbPlaceholderJob({
    mutation: {
      onSuccess: () => {
        toast({ title: "Placeholder job updated", description: `Updated for ${technicianName}.` });
        invalidate();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to update placeholder job",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const deleteMutation = useDeleteWbPlaceholderJob({
    mutation: {
      onSuccess: () => {
        toast({ title: "Placeholder job removed" });
        invalidate();
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to remove placeholder job",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const handleLocationChange = (loc: ServiceLocationValue | null) => {
    setServiceLocation(loc);
    if (loc) {
      setCustomerName(loc.name ?? "");
      setCity(loc.city ?? "");
      setStateVal(loc.state ?? "");
    }
  };

  const submit = () => {

    const start = fromLocalInput(startTime);
    const end = fromLocalInput(endTime);
    if (!start || !end) {
      toast({ title: "Invalid times", description: "Please enter valid start and end times.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      id: job.id,
      data: {
        title: job.title,
        customer_name: customerName.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        service_location_id: serviceLocation?.id ?? null,
        start_time: start,
        end_time: end,
        notes: notes.trim() || null,
        status: (jobStatus || null) as Parameters<typeof updateMutation.mutate>[0]["data"]["status"],
        color_index: colorIndex,
      },
    });
  };

  const busy = updateMutation.isPending || deleteMutation.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit placeholder job</DialogTitle>
          <DialogDescription>{technicianName} · Not yet confirmed in CRM</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0 overflow-y-auto flex-1 pr-1">
          <div className="relative">
            <ServiceLocationPicker
              label="Service location"
              value={serviceLocation}
              onChange={handleLocationChange}
            />
            {job.service_location_id && (
              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                <span>ID: {locDetail?.service_loc_id ?? serviceLocation?.service_loc_id ?? job.service_location_id}</span>
                <Link
                  href={`/service-location/${job.service_location_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View details
                </Link>
              </div>
            )}
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="ph-edit-customer">Customer name</Label>
            <Input
              id="ph-edit-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full min-w-0"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="ph-edit-city">City</Label>
              <Input
                id="ph-edit-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full min-w-0"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="ph-edit-state">State</Label>
              <Input
                id="ph-edit-state"
                value={state}
                onChange={(e) => setStateVal(e.target.value)}
                className="w-full min-w-0"
              />
            </div>
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="ph-edit-status">Status <span className="text-muted-foreground">(optional)</span></Label>
            <Select value={jobStatus} onValueChange={setJobStatus}>
              <SelectTrigger id="ph-edit-status" className="w-full">
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

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="ph-edit-start">Start time</Label>
            <Input
              id="ph-edit-start"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="ph-edit-end">End time</Label>
            <Input
              id="ph-edit-end"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>

          <ChipColorPicker value={colorIndex} onChange={setColorIndex} />

          <div className="space-y-1.5">
            <Label htmlFor="ph-edit-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="ph-edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-row flex-wrap justify-between sm:justify-between sm:space-x-0 shrink-0">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => deleteMutation.mutate({ id: job.id })}
            disabled={busy}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Trash2 className="h-4 w-4 mr-1.5" />
            )}
            Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Save changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
