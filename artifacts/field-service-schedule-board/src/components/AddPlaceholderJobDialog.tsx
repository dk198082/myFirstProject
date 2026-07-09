import { useState } from "react";
import {
  useCreateWbPlaceholderJob,
  getListWbPlaceholderJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AddPlaceholderJobDialog({
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

  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [city, setCity] = useState("");
  const [state, setStateVal] = useState("");
  const [startTime, setStartTime] = useState(`${date}T09:00`);
  const [endTime, setEndTime] = useState(`${date}T11:00`);
  const [notes, setNotes] = useState("");

  const createMutation = useCreateWbPlaceholderJob({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Placeholder job added",
          description: `Added for ${technicianName}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListWbPlaceholderJobsQueryKey() });
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to add placeholder job",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const submit = () => {
    if (!title.trim()) {
      toast({ title: "Title required", description: "Please enter a job title.", variant: "destructive" });
      return;
    }
    const start = fromLocalInput(startTime);
    const end = fromLocalInput(endTime);
    if (!start || !end) {
      toast({ title: "Invalid times", description: "Please enter valid start and end times.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      data: {
        technician_id: technicianId,
        title: title.trim(),
        customer_name: customerName.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        start_time: start,
        end_time: end,
        notes: notes.trim() || null,
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add placeholder job</DialogTitle>
          <DialogDescription>{technicianName} · {date} · Not yet confirmed in CRM</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0 overflow-hidden">
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="ph-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ph-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Furnace install"
              className="w-full min-w-0"
              autoFocus
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
            <Label htmlFor="ph-start">Start time</Label>
            <Input
              id="ph-start"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="ph-end">End time</Label>
            <Input
              id="ph-end"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full min-w-0 block"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ph-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="ph-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Waiting on customer to confirm"
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-row flex-wrap justify-end sm:space-x-0">
          <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Add placeholder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
