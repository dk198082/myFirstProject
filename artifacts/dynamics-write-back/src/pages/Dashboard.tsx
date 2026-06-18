import { useState, useMemo } from "react";
import {
  useGetWbReportFilters,
  useGetWbReportCompletedNotApproved,
  useGetWbReportApprovedNotInvoiced,
  useGetWbReportWeeklyApproved,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, Legend } from "recharts";
import { ClipboardCheck, FileWarning, CalendarDays } from "lucide-react";

const REGION_COLORS: Record<string, string> = {
  R1: "#2563eb", R2: "#16a34a", R3: "#f59e0b", R4: "#db2777",
  R5: "#7c3aed", R8: "#0891b2", "(Blank)": "#94a3b8",
};
const FALLBACK_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#db2777", "#7c3aed", "#0891b2", "#94a3b8", "#ef4444"];

const MONTHS = [
  { v: "1", l: "January" }, { v: "2", l: "February" }, { v: "3", l: "March" },
  { v: "4", l: "April" }, { v: "5", l: "May" }, { v: "6", l: "June" },
  { v: "7", l: "July" }, { v: "8", l: "August" }, { v: "9", l: "September" },
  { v: "10", l: "October" }, { v: "11", l: "November" }, { v: "12", l: "December" },
];

const ALL = "__all__";

function regionColor(region: string, i: number) {
  return REGION_COLORS[region] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function formatDate(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleDateString("en-US", {
      day: "2-digit", month: "short", year: "2-digit",
    });
  } catch {
    return dt;
  }
}

function FilterSelect({
  label, value, onChange, options, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-44 bg-background">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function KpiCard({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 p-6">
        <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
        <div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RegionDonut({ data }: { data: { region: string; count: number }[] }) {
  if (data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="region"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
          isAnimationActive={false}
          label={(e: { region: string; count: number }) => `${e.region}: ${e.count}`}
          labelLine={false}
        >
          {data.map((d, i) => (
            <Cell key={d.region} fill={regionColor(d.region, i)} />
          ))}
        </Pie>
        <RTooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

const TABLE_COLS = [
  "FSA SRVNum", "AX SRV Num", "Comp", "Region", "Location",
  "Customer Name", "Technician", "Completed On", "Approved On",
  "Approved By", "OrderStatus",
];

type ReportRow = {
  fsa_srv_num: string | null;
  ax_srv_num: string | null;
  company: string | null;
  region: string;
  location: string | null;
  customer_name: string | null;
  technician: string | null;
  completed_on: string | null;
  approved_on: string | null;
  approved_by: string | null;
  order_status: string | null;
};

function ReportTable({ rows }: { rows: ReportRow[] }) {
  return (
    <div className="rounded-md border">
      <div className="max-h-[520px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
            <TableRow>
              {TABLE_COLS.map((c) => (
                <TableHead key={c} className="whitespace-nowrap text-xs font-semibold">{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={TABLE_COLS.length} className="h-24 text-center text-muted-foreground">
                  No service orders match the selected filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={`${r.fsa_srv_num}-${i}`} className="text-sm">
                  <TableCell className="whitespace-nowrap font-medium">{r.fsa_srv_num ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.ax_srv_num ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.company ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.region}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.location ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={r.customer_name ?? ""}>{r.customer_name ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.technician ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.completed_on)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.approved_on)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.approved_by ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.order_status ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ServiceOrderReportView({
  title, icon, accent, total, byRegion, rows, loading,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  total: number;
  byRegion: { region: string; count: number }[];
  rows: ReportRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 md:col-span-1" />
        <Skeleton className="h-28 md:col-span-2" />
        <Skeleton className="h-80 md:col-span-3" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard icon={icon} label={title} value={total.toLocaleString()} accent={accent} />
        <Card className="md:col-span-2">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Count of Service Order by Region</CardTitle>
          </CardHeader>
          <CardContent>
            <RegionDonut data={byRegion} />
          </CardContent>
        </Card>
      </div>
      <ReportTable rows={rows} />
    </div>
  );
}

export default function Dashboard() {
  const { data: filters } = useGetWbReportFilters();
  const regions = filters?.regions ?? [];
  const years = filters?.years ?? [];
  const approvers = filters?.approvers ?? [];

  const regionOpts = regions.map((r) => ({ v: r, l: r }));
  const yearOpts = years.map((y) => ({ v: String(y), l: String(y) }));
  const approverOpts = approvers.map((a) => ({ v: a, l: a }));

  const currentYear = String(new Date().getFullYear());

  // Page 1 filters
  const [p1Region, setP1Region] = useState(ALL);
  const [p1Year, setP1Year] = useState(currentYear);
  const [p1Month, setP1Month] = useState(ALL);

  // Page 2 filters
  const [p2Region, setP2Region] = useState(ALL);

  // Page 4 filters
  const [p4Region, setP4Region] = useState(ALL);
  const [p4Year, setP4Year] = useState(currentYear);
  const [p4Month, setP4Month] = useState(ALL);
  const [p4Approver, setP4Approver] = useState(ALL);

  const param = (v: string) => (v === ALL ? undefined : v);
  const numParam = (v: string) => (v === ALL ? undefined : Number(v));

  const p1 = useGetWbReportCompletedNotApproved({
    region: param(p1Region),
    year: numParam(p1Year),
    month: numParam(p1Month),
  });
  const p2 = useGetWbReportApprovedNotInvoiced({ region: param(p2Region) });
  const p4 = useGetWbReportWeeklyApproved({
    region: param(p4Region),
    year: numParam(p4Year),
    month: numParam(p4Month),
    approved_by: param(p4Approver),
  });

  const weekData = p4.data;
  const grandWeekTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    if (!weekData) return totals;
    for (const a of weekData.approvers) {
      for (const [wk, n] of Object.entries(a.weeks)) {
        totals[wk] = (totals[wk] ?? 0) + (n as number);
      }
    }
    return totals;
  }, [weekData]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Service Management Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Service-order approval and invoicing status, sourced from d365crm.
        </p>
      </div>

      <Tabs
        defaultValue="completed-not-approved"
        orientation="vertical"
        className="flex flex-col gap-6 sm:flex-row sm:items-start"
      >
        <TabsList className="h-auto w-full shrink-0 flex-col items-stretch justify-start gap-1 p-1 sm:w-56">
          <TabsTrigger className="w-full justify-start" value="completed-not-approved">Completed not Approved</TabsTrigger>
          <TabsTrigger className="w-full justify-start" value="approved-not-invoiced">Approved not Invoiced</TabsTrigger>
          <TabsTrigger className="w-full justify-start" value="weekly-approved">Weekly Approved</TabsTrigger>
        </TabsList>

        <div className="min-w-0 flex-1">
        {/* Page 1 */}
        <TabsContent value="completed-not-approved" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect label="Region" value={p1Region} onChange={setP1Region} options={regionOpts} placeholder="All regions" />
            <FilterSelect label="Year" value={p1Year} onChange={setP1Year} options={yearOpts} placeholder="All years" />
            <FilterSelect label="Month" value={p1Month} onChange={setP1Month} options={MONTHS} placeholder="All months" />
          </div>
          <ServiceOrderReportView
            title="Service Orders Completed not Approved"
            icon={<ClipboardCheck className="h-6 w-6 text-amber-600" />}
            accent="bg-amber-100"
            total={p1.data?.total ?? 0}
            byRegion={p1.data?.by_region ?? []}
            rows={(p1.data?.rows ?? []) as ReportRow[]}
            loading={p1.isLoading}
          />
        </TabsContent>

        {/* Page 2 */}
        <TabsContent value="approved-not-invoiced" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect label="Region" value={p2Region} onChange={setP2Region} options={regionOpts} placeholder="All regions" />
          </div>
          <ServiceOrderReportView
            title="Approved not Invoiced"
            icon={<FileWarning className="h-6 w-6 text-rose-600" />}
            accent="bg-rose-100"
            total={p2.data?.total ?? 0}
            byRegion={p2.data?.by_region ?? []}
            rows={(p2.data?.rows ?? []) as ReportRow[]}
            loading={p2.isLoading}
          />
        </TabsContent>

        {/* Page 4 */}
        <TabsContent value="weekly-approved" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <FilterSelect label="Year" value={p4Year} onChange={setP4Year} options={yearOpts} placeholder="All years" />
            <FilterSelect label="Approved By" value={p4Approver} onChange={setP4Approver} options={approverOpts} placeholder="All approvers" />
            <FilterSelect label="Region" value={p4Region} onChange={setP4Region} options={regionOpts} placeholder="All regions" />
            <FilterSelect label="Month" value={p4Month} onChange={setP4Month} options={MONTHS} placeholder="All months" />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <KpiCard
              icon={<CalendarDays className="h-6 w-6 text-violet-600" />}
              label="Total Approved"
              value={(weekData?.total ?? 0).toLocaleString()}
              accent="bg-violet-100"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Count of Approved Service Orders by Approved By &amp; Week Number
              </CardTitle>
            </CardHeader>
            <CardContent>
              {p4.isLoading ? (
                <Skeleton className="h-80 w-full" />
              ) : (
                <div className="rounded-md border">
                  <div className="max-h-[560px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                        <TableRow>
                          <TableHead className="sticky left-0 z-10 bg-muted/95 text-xs font-semibold">Approved By</TableHead>
                          {(weekData?.week_numbers ?? []).map((w) => (
                            <TableHead key={w} className="text-center text-xs font-semibold tabular-nums">{w}</TableHead>
                          ))}
                          <TableHead className="text-center text-xs font-semibold">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(weekData?.approvers ?? []).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={(weekData?.week_numbers.length ?? 0) + 2} className="h-24 text-center text-muted-foreground">
                              No approvals match the selected filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          (weekData?.approvers ?? []).map((a) => (
                            <TableRow key={a.approved_by} className="text-sm">
                              <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-background font-medium">{a.approved_by}</TableCell>
                              {(weekData?.week_numbers ?? []).map((w) => (
                                <TableCell key={w} className="text-center tabular-nums text-muted-foreground">
                                  {a.weeks[String(w)] ?? ""}
                                </TableCell>
                              ))}
                              <TableCell className="text-center font-semibold tabular-nums">{a.total}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                      {(weekData?.approvers ?? []).length > 0 && (
                        <tfoot className="sticky bottom-0 bg-muted/95 backdrop-blur">
                          <TableRow>
                            <TableCell className="sticky left-0 z-10 bg-muted/95 font-semibold">Total</TableCell>
                            {(weekData?.week_numbers ?? []).map((w) => (
                              <TableCell key={w} className="text-center font-semibold tabular-nums">
                                {grandWeekTotals[String(w)] ?? ""}
                              </TableCell>
                            ))}
                            <TableCell className="text-center font-semibold tabular-nums">{weekData?.total ?? 0}</TableCell>
                          </TableRow>
                        </tfoot>
                      )}
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
