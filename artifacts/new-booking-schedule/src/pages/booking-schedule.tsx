import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBookingSlots,
  getGetBookingSlotsQueryKey,
  useUpdateBookingSlot,
  useSwapBookingSlots,
  useCreateBookingSlot,
  useDeleteBookingSlot,
  useResetBookingSlots,
  AssignableOrder,
  SalesOrderRef
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { computeSlotDates } from "@/lib/business-days";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import AllocateDialog, { getStatusLabel, getStatusBadgeVariant } from "@/components/AllocateDialog";
import SalesOrderPicker from "@/components/SalesOrderPicker";
import { BarChart2, Settings2, CalendarDays, ChevronUp, ChevronDown, Plus, X, Pencil, Check, AlertTriangle, Ship, Clock, Trash2, RotateCcw } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

const TABS = ["300SL", "600SL", "1000/2000SL", "MetalsImpact", "MFI"];

export function BookingSchedule() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const queryClient = useQueryClient();

  const { data: slots, isLoading } = useGetBookingSlots(
    { tab: activeTab },
    { query: { queryKey: getGetBookingSlotsQueryKey({ tab: activeTab }) } }
  );

  const swapSlots = useSwapBookingSlots();
  const createSlot = useCreateBookingSlot();
  const deleteSlot = useDeleteBookingSlot();
  const resetSlots = useResetBookingSlots();

  const invalidateTab = () =>
    queryClient.invalidateQueries({ queryKey: getGetBookingSlotsQueryKey({ tab: activeTab }) });

  const allSlots = slots ?? [];
  const lateCount = allSlots.filter(
    (s) => (s.prodOrder || s.salesOrder) && slotIsLate(s)
  ).length;
  const nextAvail = allSlots
    .filter((s) => !s.salesOrder)
    .map((s) => ({
      ship: computeSlotDates(s.productionStart, s.assyDays, s.packDays, s.pickDays).ship,
    }))
    .filter((x) => x.ship && !isPastDate(x.ship))
    .sort((a, b) => (a.ship! < b.ship! ? -1 : 1))[0];
  const nextShip = nextAvail?.ship ?? null;
  const nextLead = leadWeeksFor(nextShip);

  const handleMove = (index: number, dir: -1 | 1) => {
    if (!slots) return;
    const target = index + dir;
    if (target < 0 || target >= slots.length) return;
    swapSlots.mutate(
      { data: { sourceId: slots[index].id, targetId: slots[target].id } },
      { onSuccess: invalidateTab }
    );
  };

  const handleAddSlot = () => {
    const dated = allSlots
      .map((s) => (s.productionStart ? s.productionStart.split("T")[0] : null))
      .filter((d): d is string => !!d)
      .sort();
    const last = dated[dated.length - 1];
    const productionStart = last ? addDaysIso(last, CADENCE_INTERVAL_DAYS) : undefined;
    createSlot.mutate(
      { data: { tab: activeTab, ...(productionStart ? { productionStart } : {}) } },
      { onSuccess: invalidateTab }
    );
  };

  const handleDelete = (id: number) => {
    deleteSlot.mutate({ id }, { onSuccess: invalidateTab });
  };

  const handleReset = () => {
    resetSlots.mutate({ data: { tab: activeTab } }, { onSuccess: invalidateTab });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 flex items-center gap-4 print:hidden">
        <div className="flex items-center gap-2 py-3 pr-4 border-r border-border shrink-0">
          <BarChart2 className="w-5 h-5 text-primary" />
          <span className="font-bold uppercase tracking-tight">New Booking Schedule</span>
        </div>
        <nav className="flex items-stretch h-full -mb-px">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            data-testid="link-new-booking"
          >
            <CalendarDays className="w-4 h-4" />
            New Booking / Schedule
          </button>
          <span className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-primary text-foreground">
            <CalendarDays className="w-4 h-4" />
            Booking / Schedule
          </span>
        </nav>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 w-full justify-start h-12 bg-card border">
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} data-testid={`tab-${tab}`} className="h-9 px-6 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card p-4 flex items-center gap-3" data-testid="summary-orders-late">
              <div className={`h-10 w-10 shrink-0 rounded-md flex items-center justify-center ${lateCount > 0 ? "bg-red-50 text-red-600" : "bg-muted text-muted-foreground"}`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Orders Late</div>
                <div className={`text-2xl font-bold leading-tight ${lateCount > 0 ? "text-red-600" : "text-foreground"}`}>{lateCount}</div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-4 flex items-center gap-3" data-testid="summary-next-ship">
              <div className="h-10 w-10 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Ship className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Next Available Ship Date</div>
                <div className="text-2xl font-bold leading-tight text-foreground">{nextShip ? formatMDY(nextShip) : "—"}</div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-4 flex items-center gap-3" data-testid="summary-lead-time">
              <div className="h-10 w-10 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Clock className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Current Lead Time</div>
                <div className="text-2xl font-bold leading-tight text-foreground">
                  {nextLead != null ? `${nextLead} ${Math.abs(nextLead) === 1 ? "week" : "weeks"}` : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground" data-testid="text-slot-count">
              {allSlots.length} {allSlots.length === 1 ? "slot" : "slots"} in {activeTab}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddSlot}
                disabled={createSlot.isPending}
                data-testid="btn-add-slot"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Slot
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={resetSlots.isPending} data-testid="btn-reset-cadence">
                    <RotateCcw className="h-4 w-4 mr-1.5" />
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate {activeTab} cadence?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This deletes all {allSlots.length} slots in {activeTab} — including any allocated
                      production or sales orders — and rebuilds a fresh bi-weekly cadence. This can't be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleReset}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {TABS.map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-0 focus-visible:outline-none">
              <Card className="shadow-sm">
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="p-8 space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : (
                    <div className="divide-y">
                      {slots?.map((slot, index) => (
                        <SlotRow
                          key={slot.id}
                          slot={slot}
                          activeTab={activeTab}
                          index={index}
                          canMoveUp={index > 0}
                          canMoveDown={index < slots.length - 1}
                          moving={swapSlots.isPending}
                          deleting={deleteSlot.isPending}
                          onMoveUp={() => handleMove(index, -1)}
                          onMoveDown={() => handleMove(index, 1)}
                          onDelete={() => handleDelete(slot.id)}
                        />
                      ))}
                      {slots?.length === 0 && (
                        <div className="p-12 text-center flex flex-col items-center justify-center">
                          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                            <CalendarDays className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <h3 className="text-lg font-medium mb-1">No slots scheduled</h3>
                          <p className="text-sm text-muted-foreground max-w-sm">
                            No booking slots are available for {activeTab} yet.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}

const CADENCE_INTERVAL_DAYS = 14;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMDY(isoDate: string) {
  const d = isoDate.split("T")[0];
  return `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
}

function isPastDate(d: string | null) {
  if (!d) return false;
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return new Date(d + "T00:00:00").getTime() < todayMs;
}

function leadWeeksFor(ship: string | null): number | null {
  if (!ship) return null;
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const shipMs = new Date(ship + "T00:00:00").getTime();
  const days = Math.round((shipMs - todayMs) / 86400000);
  return days >= 0 ? Math.ceil(days / 7) : Math.floor(days / 7);
}

function slotIsLate(slot: any): boolean {
  const d = computeSlotDates(slot.productionStart, slot.assyDays, slot.packDays, slot.pickDays);
  const progress = (slot.progress ?? {}) as Record<string, boolean>;
  const pairs: Array<[string, string | null]> = [
    ["pickStart", d.pickStart],
    ["pickEnd", d.pickEnd],
    ["assyStart", d.assyStart],
    ["assyEnd", d.assyEnd],
    ["packStart", d.packStart],
    ["packEnd", d.packEnd],
  ];
  return pairs.some(([k, date]) => isPastDate(date) && !progress[k]);
}

function SlotRow({ slot, activeTab, index, canMoveUp, canMoveDown, moving, deleting, onMoveUp, onMoveDown, onDelete }: { slot: any, activeTab: string, index: number, canMoveUp: boolean, canMoveDown: boolean, moving: boolean, deleting: boolean, onMoveUp: () => void, onMoveDown: () => void, onDelete: () => void }) {
  const queryClient = useQueryClient();
  const updateSlot = useUpdateBookingSlot();

  const [allocateOpen, setAllocateOpen] = useState(false);
  const [soPickerOpen, setSoPickerOpen] = useState(false);

  const { pickStart, pickEnd, assyStart, assyEnd, packStart, packEnd, ship } = computeSlotDates(slot.productionStart, slot.assyDays, slot.packDays, slot.pickDays);
  const leadWeeks = leadWeeksFor(ship);

  const handleShift = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateSlot.mutate(
      { id: slot.id, data: { productionStart: e.target.value } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBookingSlotsQueryKey({ tab: activeTab }) }) }
    );
  };

  const handleDurations = (field: 'assyDays'|'packDays'|'pickDays', val: string) => {
    const parsed = Number(val);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    updateSlot.mutate(
      { id: slot.id, data: { [field]: safe } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBookingSlotsQueryKey({ tab: activeTab }) }) }
    );
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetBookingSlotsQueryKey({ tab: activeTab }) });

  const progress = (slot.progress ?? {}) as Record<string, boolean>;
  const toggleProgress = (key: string) => {
    const next: Record<string, boolean> = { ...progress };
    if (next[key]) delete next[key];
    else next[key] = true;
    updateSlot.mutate({ id: slot.id, data: { progress: next } }, { onSuccess: invalidate });
  };

  const renderPhase = (
    label: string,
    startKey: string,
    startDate: string | null,
    endKey: string,
    endDate: string | null,
  ) => {
    const startDone = !!progress[startKey];
    const endDone = !!progress[endKey];
    const fill = endDone ? 100 : startDone ? 50 : 0;

    const todayMs = (() => {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    })();
    const isPast = (d: string | null) =>
      !!d && new Date(d + "T00:00:00").getTime() < todayMs;

    const complete = startDone && endDone;
    const startLate = isPast(startDate) && !startDone;
    const endLate = isPast(endDate) && !endDone;
    const anyLate = startLate || endLate;

    const fillClass = complete
      ? "bg-green-500"
      : anyLate
        ? "bg-red-500"
        : "bg-primary";
    const textClass = complete
      ? "text-green-600"
      : anyLate
        ? "text-red-600"
        : "text-muted-foreground";
    const doneNodeClass = complete
      ? "bg-green-500 border-green-500 text-white"
      : "bg-primary border-primary text-primary-foreground";

    const node = (
      key: string,
      done: boolean,
      lateNode: boolean,
      title: string,
      testid: string,
    ) => (
      <button
        type="button"
        onClick={() => toggleProgress(key)}
        title={title}
        aria-label={title}
        aria-pressed={done}
        data-testid={testid}
        className={`h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
          done
            ? doneNodeClass
            : `bg-background text-transparent hover:border-primary ${lateNode ? "border-red-500" : "border-muted-foreground/40"}`
        }`}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </button>
    );
    return (
      <div className="flex flex-col gap-0.5">
        <span className={`text-[10px] uppercase font-semibold tracking-wider text-center ${textClass}`}>
          {label}
        </span>
        <div className="flex items-center gap-1">
          {node(startKey, startDone, startLate, `${label} start complete`, `chk-${startKey}-${slot.id}`)}
          <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${fillClass}`}
              style={{ width: `${fill}%` }}
            />
          </div>
          {node(endKey, endDone, endLate, `${label} end complete`, `chk-${endKey}-${slot.id}`)}
        </div>
        <div className="flex justify-between px-0.5">
          <span className={`text-[9px] font-medium ${complete ? "text-green-600" : startLate ? "text-red-600" : "text-muted-foreground"}`}>{startDate ? startDate.slice(5) : "-"}</span>
          <span className={`text-[9px] font-medium ${complete ? "text-green-600" : endLate ? "text-red-600" : "text-muted-foreground"}`}>{endDate ? endDate.slice(5) : "-"}</span>
        </div>
      </div>
    );
  };

  const onAllocateProd = (order: AssignableOrder) => {
    const data: Record<string, unknown> = {
      prodOrder: order.prodid,
      itemid: order.itemid,
      itemname: order.itemname,
      productionstatus: order.productionstatus,
      deliverydate: order.deliverydate,
      pool: order.pool ?? null,
      productionGroup: order.productiongroup ?? null,
      resources: order.resources ?? null,
    };
    if (!slot.salesOrder && order.demandsalesordernumber) {
      data.salesOrder = order.demandsalesordernumber;
      data.customername = order.customername;
      data.confirmedShipDate = order.confirmedshipdate ?? null;
      data.inPacking = order.inpacking ?? null;
    }
    updateSlot.mutate({ id: slot.id, data }, { onSuccess: invalidate });
  };

  const handleClearProd = () => {
    updateSlot.mutate(
      {
        id: slot.id,
        data: {
          prodOrder: null,
          itemid: null,
          itemname: null,
          productionstatus: null,
          deliverydate: null,
          pool: null,
          productionGroup: null,
          resources: null,
          salesOrder: slot.salesOrder ?? null,
          customername: slot.customername ?? null,
          confirmedShipDate: slot.confirmedShipDate ?? null,
          inPacking: slot.inPacking ?? null,
        },
      },
      { onSuccess: invalidate }
    );
  };

  const onAllocateSO = (so: SalesOrderRef) => {
    updateSlot.mutate(
      {
        id: slot.id,
        data: {
          salesOrder: so.salesordernumber,
          customername: so.customername,
          confirmedShipDate: so.confirmedshipdate ?? null,
          inPacking: so.inpacking ?? null,
        },
      },
      { onSuccess: invalidate }
    );
  };

  const handleClearSO = () => {
    updateSlot.mutate(
      { id: slot.id, data: { salesOrder: null, customername: null, confirmedShipDate: null, inPacking: null } },
      { onSuccess: invalidate }
    );
  };

  const isPending = updateSlot.isPending;

  return (
    <>
      <div
        className={`p-4 flex flex-col md:flex-row gap-6 hover:bg-muted/30 transition-all ${isPending || deleting ? 'opacity-50 pointer-events-none' : ''}`}
        style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
        data-testid={`slot-${slot.id}`}
      >
        <div className="flex flex-col gap-2 md:w-52 shrink-0 py-1">
          {renderPhase("Pick", "pickStart", pickStart, "pickEnd", pickEnd)}
          {renderPhase("Build", "assyStart", assyStart, "assyEnd", assyEnd)}
          {renderPhase("Pack", "packStart", packStart, "packEnd", packEnd)}
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Production Order</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Prod Start</span>
                <input
                  type="date"
                  value={slot.productionStart ? slot.productionStart.split('T')[0] : ''}
                  onChange={handleShift}
                  className="text-xs font-medium bg-secondary/30 border border-border/50 rounded px-1.5 py-0.5 outline-none cursor-pointer text-foreground"
                  data-testid={`input-prodstart-${slot.id}`}
                />
              </div>
            </div>
            {slot.prodOrder ? (
              <div className="flex-1 bg-card border shadow-sm rounded-lg p-3 flex flex-col gap-2 relative overflow-hidden">
                <button
                  onClick={handleClearProd}
                  title="Clear production order"
                  className="absolute right-1.5 top-1.5 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                  data-testid={`btn-clear-prod-${slot.id}`}
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 flex-wrap pr-6">
                  <span className="font-bold text-base text-foreground">{slot.prodOrder}</span>
                  <Badge variant={getStatusBadgeVariant(slot.productionstatus)} className="h-5 text-[10px]">
                    {getStatusLabel(slot.productionstatus)}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {slot.itemid} <span className="mx-1 text-border">•</span> <span className="text-foreground">{slot.itemname}</span>
                </div>
                {(slot.pool || slot.productionGroup) && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {slot.pool && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-muted text-muted-foreground font-medium">
                        <span className="font-semibold uppercase tracking-wider text-[10px] opacity-70">Pool</span>
                        {slot.pool}
                      </span>
                    )}
                    {slot.productionGroup && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-muted text-muted-foreground font-medium">
                        <span className="font-semibold uppercase tracking-wider text-[10px] opacity-70">Prod Group</span>
                        {slot.productionGroup}
                      </span>
                    )}
                  </div>
                )}
                {slot.resources && (
                  <div className="flex items-start gap-1.5 text-xs pr-6" data-testid={`prod-resources-${slot.id}`}>
                    <span className="font-semibold uppercase tracking-wider text-[10px] opacity-70 text-muted-foreground mt-0.5 shrink-0">Resources</span>
                    <span className="text-foreground">{slot.resources}</span>
                  </div>
                )}
                <button
                  onClick={() => setAllocateOpen(true)}
                  title="Modify production order"
                  aria-label="Modify production order"
                  className="absolute right-1.5 bottom-1.5 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  data-testid={`btn-change-prod-${slot.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAllocateOpen(true)}
                className="flex-1 min-h-[110px] w-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-primary/50 cursor-pointer transition-all bg-card/50"
                data-testid={`btn-allocate-prod-${slot.id}`}
              >
                <Plus className="h-5 w-5 text-muted-foreground/50" />
                <span className="font-medium text-sm">Select Production Order</span>
              </button>
            )}
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Sales Order</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Ship Date</span>
                  <span className="text-xs font-medium bg-secondary/30 border border-border/50 rounded px-1.5 py-0.5">{ship ? formatMDY(ship) : '-'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase text-muted-foreground font-semibold tracking-wider">Lead Time</span>
                  <span className="text-xs font-medium bg-secondary/30 border border-border/50 rounded px-1.5 py-0.5">{leadWeeks != null ? `${leadWeeks} ${Math.abs(leadWeeks) === 1 ? 'week' : 'weeks'}` : '-'}</span>
                </div>
              </div>
            </div>
            {slot.salesOrder ? (
              <div className="flex-1 bg-card border shadow-sm rounded-lg p-3 flex flex-col gap-2 relative overflow-hidden">
                <button
                  onClick={handleClearSO}
                  title="Clear sales order"
                  className="absolute right-1.5 top-1.5 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                  data-testid={`btn-clear-so-${slot.id}`}
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 flex-wrap pr-6">
                  <span className="font-bold text-base text-foreground">{slot.salesOrder}</span>
                  {slot.inPacking === 1 && (
                    <Badge variant="secondary" className="h-5 text-[10px]">In Packing</Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {slot.customername || 'No customer info'}
                </div>
                {slot.confirmedShipDate && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wider mr-1">Confirmed Ship:</span>
                    {formatMDY(slot.confirmedShipDate)}
                  </div>
                )}
                <button
                  onClick={() => setSoPickerOpen(true)}
                  title="Modify sales order"
                  aria-label="Modify sales order"
                  className="absolute right-1.5 bottom-1.5 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  data-testid={`btn-change-so-${slot.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSoPickerOpen(true)}
                className="flex-1 min-h-[110px] w-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground hover:border-amber-500/50 cursor-pointer transition-all bg-card/50"
                data-testid={`btn-allocate-so-${slot.id}`}
              >
                <Plus className="h-5 w-5 text-muted-foreground/50" />
                <span className="font-medium text-sm">Select Sales Order</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex md:flex-col items-center justify-center gap-2 md:w-12 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            disabled={!canMoveUp || moving}
            onClick={onMoveUp}
            title="Move booking up"
            data-testid={`btn-move-up-${slot.id}`}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            disabled={!canMoveDown || moving}
            onClick={onMoveDown}
            title="Move booking down"
            data-testid={`btn-move-down-${slot.id}`}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <Settings2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" align="end">
              <div className="space-y-4">
                <h4 className="font-medium text-sm">Slot Durations (Days)</h4>
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 items-center gap-4">
                    <Label className="text-xs">Work Order Pick</Label>
                    <Input
                      type="number"
                      min={0}
                      value={slot.pickDays}
                      onChange={(e) => handleDurations('pickDays', e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-4">
                    <Label className="text-xs">Assembly</Label>
                    <Input
                      type="number"
                      min={0}
                      value={slot.assyDays}
                      onChange={(e) => handleDurations('assyDays', e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="grid grid-cols-2 items-center gap-4">
                    <Label className="text-xs">Pack</Label>
                    <Input
                      type="number"
                      min={0}
                      value={slot.packDays}
                      onChange={(e) => handleDurations('packDays', e.target.value)}
                      className="h-8"
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                disabled={deleting}
                title="Delete slot"
                aria-label="Delete slot"
                data-testid={`btn-delete-slot-${slot.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this slot?</AlertDialogTitle>
                <AlertDialogDescription>
                  {(slot.prodOrder || slot.salesOrder)
                    ? "This slot has an order allocated. Deleting it removes the slot and clears its allocation."
                    : "This permanently removes the slot from this tab."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <AllocateDialog
        open={allocateOpen}
        onOpenChange={setAllocateOpen}
        tab={activeTab}
        onSelect={onAllocateProd}
      />

      <SalesOrderPicker
        open={soPickerOpen}
        onOpenChange={setSoPickerOpen}
        onSelect={onAllocateSO}
      />
    </>
  );
}
