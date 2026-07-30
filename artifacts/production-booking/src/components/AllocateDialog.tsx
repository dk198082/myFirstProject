import React, { useState } from "react";
import {
  useGetAssignableOrders,
  getGetAssignableOrdersQueryKey,
  AssignableOrder,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_TABS = ["300SL", "600SL", "1000/2000SL", "MetalsImpact"];
const ANY_TAB = "__all__";

export function getStatusLabel(status: number | null | undefined): string {
  switch (status) {
    case 0: return "Created";
    case 1: return "Estimated";
    case 2: return "Scheduled";
    case 3: return "Released";
    case 4: return "Started";
    case 5: return "Reported As Finished";
    case 6: return "Ended";
    case 7: return "Ordered";
    default: return "Unknown";
  }
}

export function getStatusBadgeVariant(status: number | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 3:
    case 4: return "default";
    case 5:
    case 6: return "secondary";
    default: return "outline";
  }
}

interface AllocateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: string;
  onSelect: (order: AssignableOrder) => void;
}

export default function AllocateDialog({ open, onOpenChange, tab, onSelect }: AllocateDialogProps) {
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState(tab);

  // Default the filter to this slot's tab each time the dialog opens, but allow
  // the planner to override and place an order from any other product line.
  React.useEffect(() => {
    if (open) setFilterTab(tab);
  }, [open, tab]);

  const queryTab = filterTab === ANY_TAB ? undefined : filterTab;

  const { data: orders, isLoading } = useGetAssignableOrders(
    { search, tab: queryTab },
    { query: { queryKey: getGetAssignableOrdersQueryKey({ search, tab: queryTab }), enabled: open } }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Production Order</DialogTitle>
        </DialogHeader>
        <div className="flex-none pb-4 flex gap-2">
          <Input
            placeholder="Search orders, items, or customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-orders"
            className="flex-1"
          />
          <Select value={filterTab} onValueChange={setFilterTab}>
            <SelectTrigger className="w-44 shrink-0" data-testid="select-filter-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_TAB}>All product lines</SelectItem>
              {ALL_TABS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {orders?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No orders found.</div>
              ) : (
                orders?.map((order) => (
                  <div
                    key={order.prodid}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      onSelect(order);
                      onOpenChange(false);
                    }}
                    data-testid={`allocate-order-${order.prodid}`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary">{order.prodid}</span>
                        <Badge variant={getStatusBadgeVariant(order.productionstatus)} className="text-[10px] h-5">
                          {getStatusLabel(order.productionstatus)}
                        </Badge>
                        {order.tab && order.tab !== tab && (
                          <Badge variant="secondary" className="text-[10px] h-5" data-testid={`order-tab-${order.prodid}`}>
                            {order.tab}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium">{order.itemid}</span> — {order.itemname}
                      </div>
                      {order.customername && (
                        <div className="text-xs text-muted-foreground">
                          Customer: {order.customername}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground">
                      {order.demandsalesordernumber && (
                        <span>SO: {order.demandsalesordernumber}</span>
                      )}
                      {order.deliverydate && (
                        <span>Del: {order.deliverydate.split("T")[0]}</span>
                      )}
                      <Button variant="ghost" size="sm">Select</Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
