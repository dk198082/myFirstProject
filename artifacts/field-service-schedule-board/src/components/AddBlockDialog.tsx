import { useState } from "react";
import {
  useCreateWbScheduleBlock,
  getListWbScheduleBlocksQueryKey,
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
import { Loader2, Car, Sun } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type BlockType = "drive_time" | "pto";

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

  const [blockType, setBlockType] = useState<BlockType>("drive_time");
  const [startTime, setStartTime] = useState(`${date}T09:00`);
  const [endTime, setEndTime] = useState(`${date}T17:00`);
  const [notes, setNotes] = useState("");

  const createMutation = useCreateWbScheduleBlock({
    mutation: {
      onSuccess: () => {
        toast({
          title: blockType === "drive_time" ? "Drive time added" : "PTO added",
          description: `Block added for ${technicianName}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListWbScheduleBlocksQueryKey() });
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

  const submit = () => {
    const start = fromLocalInput(startTime);
    const end = fromLocalInput(endTime);
    if (!start || !end) {
      toast({ title: "Invalid times", description: "Please enter valid start and end times.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      data: {
        technician_id: technicianId,
        block_type: blockType,
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
          <DialogTitle>Add schedule block</DialogTitle>
          <DialogDescription>{technicianName} · {date}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0 overflow-hidden">
          {/* Block type toggle */}
          <div className="space-y-1.5">
            <Label>Block type</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBlockType("drive_time")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  blockType === "drive_time"
                    ? "bg-slate-700 text-white border-slate-700"
                    : "bg-background text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <Car className="h-4 w-4" />
                Drive Time
              </button>
              <button
                type="button"
                onClick={() => setBlockType("pto")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  blockType === "pto"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-background text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <Sun className="h-4 w-4" />
                PTO
              </button>
            </div>
          </div>

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

        <DialogFooter className="gap-2 flex-row flex-wrap justify-end sm:space-x-0">
          <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Add block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
