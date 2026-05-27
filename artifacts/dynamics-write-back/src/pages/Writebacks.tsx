import { useListWbWritebacks } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, CheckCircle2, Clock } from "lucide-react";

function fmt(iso: string | null | undefined): string {
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

export default function Writebacks() {
  const { data, isLoading, isError, refetch } = useListWbWritebacks();
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Queued Write-backs</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Staged edits ready to push to Dynamics. Most recent first.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Booking</TableHead>
                <TableHead>New Start</TableHead>
                <TableHead>New End</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Queued At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                  </TableCell>
                </TableRow>
              )}
              {isError && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-destructive">
                    Failed to load.{" "}
                    <button
                      className="underline ml-1"
                      onClick={() => refetch()}
                    >
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    No write-backs queued yet. Edit a booking to stage one.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((wb) => {
                const isSynced = wb.status === "synced" || !!wb.synced_at;
                return (
                  <TableRow key={wb.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {wb.id}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {wb.booking_id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmt(wb.start_time)}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmt(wb.end_time)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {wb.technician_name ?? (
                        <span className="text-muted-foreground">
                          {wb.technician_id ?? "—"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isSynced ? (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Synced
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Clock className="h-3 w-3" /> Queued
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmt(wb.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
