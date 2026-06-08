import { useMemo, useState, useEffect } from "react";
import {
  useListWbWorkOrders,
  useUpdateWbBooking,
  useListWbTechnicians,
  getListWbWorkOrdersQueryKey,
  getListWbWritebacksQueryKey,
  type WbWorkOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Search, Pencil, Clock, Loader2 } from "lucide-react";
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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadge(status: string | null | undefined) {
  if (!status) return null;
  const s = status.toLowerCase();
  const variant =
    s.includes("complete") ? "default" :
    s.includes("cancel") || s.includes("closed") ? "secondary" :
    s.includes("schedul") ? "default" :
    "outline";
  return <Badge variant={variant as never} className="text-[10px] font-medium">{status}</Badge>;
}

export default function WorkOrders() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [editing, setEditing] = useState<WbWorkOrder | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({ ...(debounced ? { search: debounced } : {}), limit: 200 }),
    [debounced],
  );

  const { data, isLoading, isError, refetch, isFetching } = useListWbWorkOrders(params);

  const pendingCount = (data ?? []).filter((w) => w.pending_writeback).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Work Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live from the d365crm database. Edit a booking to stage a write-back.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {pendingCount} pending
            </Badge>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search WO #, title, customer"
              className="pl-8 w-72"
            />
          </div>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">WO #</TableHead>
                <TableHead>Title / Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="w-28 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading work orders…
                  </TableCell>
                </TableRow>
              )}
              {isError && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-destructive">
                    Failed to load work orders.{" "}
                    <Button variant="link" size="sm" onClick={() => refetch()}>Retry</Button>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !isError && (data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    No work orders match your search.
                  </TableCell>
                </TableRow>
              )}
              {(data ?? []).map((wo) => {
                const pending = wo.pending_writeback;
                const status = (wo.system_status ?? "").toLowerCase();
                const editable = status === "scheduled" || status === "unscheduled";
                return (
                  <TableRow key={wo.work_order_id}>
                    <TableCell className="font-mono text-xs">
                      {wo.work_order_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium leading-tight">{wo.title ?? "Untitled"}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {wo.customer_name ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(wo.system_status)}</TableCell>
                    <TableCell className="text-sm">
                      {wo.technician_name ?? <span className="text-muted-foreground">Unassigned</span>}
                      {pending && pending.technician_id && pending.technician_id !== wo.technician_id && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          → {pending.technician_name ?? pending.technician_id}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDateTime(wo.start_time)}
                      {pending && pending.start_time && pending.start_time !== wo.start_time && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          → {fmtDateTime(pending.start_time)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDateTime(wo.end_time)}
                      {pending && pending.end_time && pending.end_time !== wo.end_time && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          → {fmtDateTime(pending.end_time)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!wo.booking_id ? (
                        <span className="text-xs text-muted-foreground">No booking</span>
                      ) : !editable ? (
                        <span className="text-xs text-muted-foreground">Locked</span>
                      ) : (
                        <Button
                          variant={pending ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setEditing(wo)}
                          className="gap-1.5"
                        >
                          <Pencil className="h-3 w-3" />
                          {pending ? "Re-edit" : "Edit"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground">
        {isFetching && !isLoading ? "Refreshing…" : `${(data ?? []).length} record${(data ?? []).length === 1 ? "" : "s"}`}
      </div>

      {editing && (
        <EditBookingDialog
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditBookingDialog({ row, onClose }: { row: WbWorkOrder; onClose: () => void }) {
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
