import React, { useState } from "react";
import { 
  useGetSalesOrders, 
  getGetSalesOrdersQueryKey,
  SalesOrderRef
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface SalesOrderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (order: SalesOrderRef) => void;
}

export default function SalesOrderPicker({ open, onOpenChange, onSelect }: SalesOrderPickerProps) {
  const [search, setSearch] = useState("");

  const { data: orders, isLoading } = useGetSalesOrders(
    { search },
    { query: { queryKey: getGetSalesOrdersQueryKey({ search }), enabled: open } }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Override Sales Order</DialogTitle>
        </DialogHeader>
        <div className="flex-none pb-4">
          <Input 
            placeholder="Search sales orders or customers..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-so"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {orders?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No sales orders found.</div>
              ) : (
                orders?.map((order) => (
                  <div 
                    key={order.salesordernumber}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => {
                      onSelect(order);
                      onOpenChange(false);
                    }}
                    data-testid={`so-${order.salesordernumber}`}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-primary">{order.salesordernumber}</span>
                      <div className="text-sm">
                        {order.customername || 'Unknown customer'}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground">
                      {order.requestedshippingdate && (
                        <span>Req Ship: {order.requestedshippingdate.split('T')[0]}</span>
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
