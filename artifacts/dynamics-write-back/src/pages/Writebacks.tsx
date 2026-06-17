import { useState } from "react";
import {
  useListWbWritebacks,
  useSyncWbWritebacks,
  getListWbWritebacksQueryKey,
  getListWbWorkOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, CheckCircle2, Clock, AlertCircle, UploadCloud, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useListWbWritebacks();
  const rows = data ?? [];

  const pendingCount = rows.filter(
    (wb) => wb.status === "queued" || wb.status === "failed",
  ).length;

  const syncMutation = useSyncWbWritebacks({
    mutation: {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListWbWritebacksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListWbWorkOrdersQueryKey() });
        if (result.failed > 0) {
          toast({
            title: `Synced ${result.synced}, ${result.failed} failed`,
            description: "Check the failed rows below for details.",
            variant: "destructive",
          });
        } else if (result.synced > 0) {
          toast({
            title: `Synced ${result.synced} write-back${result.synced === 1 ? "" : "s"}`,
            description: "Changes pushed to Dynamics.",
          });
        } else {
          toast({
            title: "Nothing to sync",
            description: "No queued write-backs were found.",
          });
        }
      },
      onError: (err) => {
        toast({
          title: "Sync failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const runSync = () => syncMutation.mutate({ data: {} });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queued Write-backs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Staged edits ready to push to Dynamics. Most recent first.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={pendingCount === 0 || syncMutation.isPending} className="gap-1.5">
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              Sync to Dynamics
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {pendingCount}
                </Badge>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Push write-backs to Dynamics?</AlertDialogTitle>
              <AlertDialogDescription>
                This will update {pendingCount} booking{pendingCount === 1 ? "" : "s"} directly in
                the live Dynamics environment. This action writes to production and cannot be undone
                from here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={runSync}>Sync now</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
                const isFailed = wb.status === "failed";
                return (
                  <TableRow key={wb.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {wb.id}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {wb.booking_id.startsWith("new:") ? (
                        <Badge variant="outline" className="gap-1 font-normal">
                          <Plus className="h-3 w-3" /> New booking
                        </Badge>
                      ) : (
                        <>{wb.booking_id.slice(0, 8)}…</>
                      )}
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
                      {isFailed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="destructive" className="gap-1 cursor-help">
                              <AlertCircle className="h-3 w-3" /> Failed
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {wb.error ?? "Unknown error"}
                          </TooltipContent>
                        </Tooltip>
                      ) : isSynced ? (
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
