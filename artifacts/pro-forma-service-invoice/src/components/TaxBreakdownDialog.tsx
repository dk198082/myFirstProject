import type { ProFormaPreview } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@workspace/production-priority-design-system/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@workspace/production-priority-design-system/components/ui/table";
import { money } from "@/lib/format";

export function TaxBreakdownDialog({ preview }: { preview: ProFormaPreview }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="text-xs font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
          data-testid="button-tax-breakdown">
          View tax calculation
        </button>
      </DialogTrigger>
      <DialogContent className="flex min-w-0 max-h-[85dvh] flex-col overflow-hidden"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "56rem" }}
        data-testid="dialog-tax-breakdown">
        <DialogHeader className="min-w-0 shrink-0">
          <DialogTitle>Sales tax calculation</DialogTitle>
          <DialogDescription>
            {preview.reference} — {preview.taxRate}% of each line’s net amount and freight.
            Line taxes and freight tax are rounded separately to two decimal places, then summed.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-sm border border-border">
          <Table style={{ minWidth: 600 }}>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="min-w-[200px]">Description</TableHead>
                <TableHead className="text-right">Tax %</TableHead>
                <TableHead className="text-right">Net amount</TableHead>
                <TableHead className="text-right">Tax calculated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.lines.map((line, index) => (
                <TableRow key={`${line.lineNumber}-${index}`} data-testid={`tax-row-${index}`}>
                  <TableCell className="tabular-nums">{line.lineNumber}</TableCell>
                  <TableCell className="whitespace-pre-line break-words">{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{preview.taxRate}%</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{money(line.netAmount, preview.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{money(line.taxAmount, preview.currency)}</TableCell>
                </TableRow>
              ))}
              <TableRow data-testid="tax-row-freight">
                <TableCell>—</TableCell>
                <TableCell>Freight</TableCell>
                <TableCell className="text-right tabular-nums">{preview.taxRate}%</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{money(preview.totals.freight, preview.currency)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{money(preview.totals.freightTax, preview.currency)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border pt-3 text-sm font-bold">
          <span>Total tax calculated</span>
          <span className="tabular-nums" data-testid="text-tax-breakdown-total">{money(preview.totals.tax, preview.currency)}</span>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">This is the sales tax amount shown in the invoice totals and generated PDF.</p>
      </DialogContent>
    </Dialog>
  );
}
