import { useState } from "react";
import {
  useUpdateWbScheduleBlock,
  getListWbScheduleBlocksQueryKey,
  type ScheduleBlock,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Car, Sun, Pencil, CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type BlockType = "drive_time" | "pto" | "custom";

const MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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
  const selectedDate = datePart ? new Date(datePart + "T00:00:00") : undefined;

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
    onChange(buildLocal(datePart, new24, minutes));
  };

  const handleMinute = (m: string) => {
    onChange(buildLocal(datePart, hours24, parseInt(m, 10)));
  };

  const handleAmPm = (v: string) => {
    const wantPM = v === "PM";
    let new24 = hours24;
    if (wantPM && !isPM) new24 = hours24 === 0 ? 12 : hours24 + 12;
    if (!wantPM && isPM) new24 = hours24 === 12 ? 0 : hours24 - 12;
    onChange(buildLocal(datePart, new24, minutes));
  };

  const dateLabel = selectedDate
    ? format(selectedDate, "EEE, MMM d, yyyy")
    : "Pick a date";

  return (
    <div className="space-y-2">
      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" className="w-full justify-start gap-2 font-normal">
            <CalendarIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className={!selectedDate ? "text-muted-foreground" : ""}>{dateLabel}</span>
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

      <div className="flex gap-2">
        <Select value={String(hours12)} onValueChange={handleHour}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
              <SelectItem key={h} value={String(h)}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={String(MINUTE_OPTIONS.includes(minutes) ? minutes : 0)}
          onValueChange={handleMinute}
        >
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MINUTE_OPTIONS.map((m) => (
              <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={isPM ? "PM" : "AM"} onValueChange={handleAmPm}>
          <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function EditBlockDialog({
  block,
  technicianName,
  onClose,
}: {
  block: ScheduleBlock;
  technicianName: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [blockType, setBlockType] = useState<BlockType>(
    block.block_type === "pto" ? "pto" : block.block_type === "custom" ? "custom" : "drive_time",
  );
  const [customTitle, setCustomTitle] = useState(block.title ?? "");
  const [startTime, setStartTime] = useState(toLocalInput(block.start_time));
  const [endTime, setEndTime] = useState(toLocalInput(block.end_time));
  const [notes, setNotes] = useState(block.notes ?? "");

  const blockLabel =
    blockType === "drive_time" ? "Drive time" : blockType === "pto" ? "PTO" : customTitle.trim() || "Custom block";

  const updateMutation = useUpdateWbScheduleBlock({
    mutation: {
      onSuccess: () => {
        toast({
          title: `${blockLabel} updated`,
          description: `Block updated for ${technicianName}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListWbScheduleBlocksQueryKey() });
        onClose();
      },
      onError: (err) => {
        toast({
          title: "Failed to update block",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const submit = () => {
    if (blockType === "custom" && !customTitle.trim()) {
      toast({ title: "Title required", description: "Please enter a title for the custom block.", variant: "destructive" });
      return;
    }
    const start = fromLocalInput(startTime);
    const end = fromLocalInput(endTime);
    if (!start || !end) {
      toast({
        title: "Invalid times",
        description: "Please enter valid start and end times.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id: block.id,
      data: {
        block_type: blockType,
        title: blockType === "custom" ? customTitle.trim() : null,
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
          <DialogTitle>Edit schedule block</DialogTitle>
          <DialogDescription>{technicianName}</DialogDescription>
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
              <button
                type="button"
                onClick={() => setBlockType("custom")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  blockType === "custom"
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
          {blockType === "custom" && (
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

          <div className="space-y-1.5 min-w-0">
            <Label>Start time</Label>
            <DateTimePicker id="block-start" value={startTime} onChange={setStartTime} />
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label>End time</Label>
            <DateTimePicker id="block-end" value={endTime} onChange={setEndTime} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="block-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
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
          <Button variant="ghost" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={updateMutation.isPending}>
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            )}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
