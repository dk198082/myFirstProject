import { Link, useParams } from "wouter";
import { useGetWorkOrderDetail } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, MapPin, Phone, Mail, Clock, User,
  Package, Wrench, AlertTriangle, CalendarClock
} from "lucide-react";

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-3 py-2 border-b border-border last:border-0">
      <span className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{String(value)}</span>
    </div>
  );
}

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return null;
  try {
    return new Date(dt).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return dt;
  }
}

function priorityBadge(p: string | null | undefined) {
  switch ((p ?? "").toLowerCase()) {
    case "high": return "destructive";
    case "medium": return "outline";
    default: return "secondary";
  }
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: wo, isLoading, error } = useGetWorkOrderDetail(id!, {
    query: { queryKey: ["getWorkOrderDetail", id], enabled: !!id }
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/" data-testid="link-back" className="flex items-center gap-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm font-medium">Back</span>
          </Link>
          <span className="text-sidebar-foreground/40 mx-1">|</span>
          <h1 className="text-xl font-bold tracking-tight">Work Order Detail</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 grid gap-6">
        {isLoading && (
          <>
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </>
        )}

        {error && (
          <div className="text-center py-20 text-destructive" data-testid="error-workorder">
            <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
            <p className="font-medium">Work order not found or failed to load.</p>
            <Link href="/" className="text-primary hover:underline mt-4 inline-block text-sm">Back to Dashboard</Link>
          </div>
        )}

        {wo && (
          <>
            {/* Main Info */}
            <Card className="border border-card-border shadow-sm" data-testid="card-workorder-info">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-1">
                      {wo.work_order_number ?? "—"}
                    </p>
                    <CardTitle className="text-xl leading-snug">{wo.title ?? "Untitled Work Order"}</CardTitle>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {wo.priority && (
                      <Badge variant={priorityBadge(wo.priority) as "destructive" | "outline" | "secondary"}>
                        {wo.priority}
                      </Badge>
                    )}
                    {wo.system_status && (
                      <Badge variant="outline">{wo.system_status}</Badge>
                    )}
                    {wo.sub_status && (
                      <Badge variant="secondary">{wo.sub_status}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                {wo.description && (
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{wo.description}</p>
                )}
                <div className="divide-y divide-border">
                  <Row label="Incident Type" value={wo.incident_type} />
                  <Row label="Service Type" value={wo.servicetype} />
                  <Row label="Service Location" value={wo.servicelocation} />
                  <Row label="Project Name" value={wo.cf_projectname} />
                  <Row label="PO Number" value={wo.cf_ponumber} />
                  <Row label="AX Service Order ID" value={wo.cf_axserviceorderid} />
                  <Row label="Price List" value={wo.pricelistname} />
                  <Row label="Created" value={formatDateTime(wo.created_on)} />
                  <Row label="Last Modified" value={formatDateTime(wo.modified_on)} />
                  {wo.serviceaddress && (
                    <div className="flex items-start gap-2 py-2 text-sm">
                      <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-0.5">Service Address</p>
                        <span className="text-foreground">{wo.serviceaddress}</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Booking Info */}
            {wo.booking && (
              <Card className="border border-card-border shadow-sm" data-testid="card-booking">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CalendarClock className="h-5 w-5 text-primary" />
                    Booking Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-border">
                    <Row label="Booking Status" value={wo.booking.booking_status} />
                    <Row label="Start Time" value={formatDateTime(wo.booking.start_time)} />
                    <Row label="End Time" value={formatDateTime(wo.booking.end_time)} />
                    <Row label="Est. Arrival" value={formatDateTime(wo.booking.estimated_arrival_time)} />
                    <Row label="Actual Arrival" value={formatDateTime(wo.booking.actual_arrival_time)} />
                    <Row label="Actual Start" value={formatDateTime(wo.booking.actual_start_time)} />
                    <Row label="Actual End" value={formatDateTime(wo.booking.actual_end_time)} />
                    <Row label="Duration" value={wo.booking.duration_minutes != null ? `${wo.booking.duration_minutes} min` : null} />
                    <Row label="CRM Start Date" value={wo.booking.crmstart_time} />
                    <Row label="CRM Start Time" value={wo.booking.crmstarttime} />
                    <Row label="CRM End Date" value={wo.booking.crmend_time} />
                    <Row label="CRM End Time" value={wo.booking.crmendtime} />
                    <Row label="Modified On" value={wo.booking.modifiedon} />
                    <Row label="Modified Time" value={wo.booking.modifiedtime} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Customer */}
            {wo.customer && (
              <Card className="border border-card-border shadow-sm" data-testid="card-customer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-5 w-5 text-primary" />
                    Customer
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-border">
                    <Row label="Name" value={wo.customer.customer_name} />
                    {wo.customer.email && (
                      <div className="flex items-center gap-2 py-2 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <a href={`mailto:${wo.customer.email}`} className="text-primary hover:underline">{wo.customer.email}</a>
                      </div>
                    )}
                    {wo.customer.phone && (
                      <div className="flex items-center gap-2 py-2 text-sm">
                        <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                        <a href={`tel:${wo.customer.phone}`} className="text-primary hover:underline">{wo.customer.phone}</a>
                      </div>
                    )}
                    <Row label="Address" value={[wo.customer.address, wo.customer.city, wo.customer.state, wo.customer.country, wo.customer.postal_code].filter(Boolean).join(", ") || null} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Services */}
            {wo.services && wo.services.length > 0 && (
              <Card className="border border-card-border shadow-sm" data-testid="card-services">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-primary" />
                    Services ({wo.services.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-border">
                    {wo.services.map((s) => (
                      <div key={s.id} className="py-3 flex items-center justify-between gap-3" data-testid={`row-service-${s.id}`}>
                        <div>
                          <p className="text-sm font-medium text-foreground">{s.service_name ?? "—"}</p>
                          {s.duration_minutes != null && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" /> {s.duration_minutes} min
                            </p>
                          )}
                        </div>
                        {s.line_status && (
                          <Badge variant="outline" className="shrink-0 text-xs">{s.line_status}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Products */}
            {wo.products && wo.products.length > 0 && (
              <Card className="border border-card-border shadow-sm" data-testid="card-products">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-5 w-5 text-primary" />
                    Products ({wo.products.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-border">
                    {wo.products.map((p) => (
                      <div key={p.id} className="py-3 flex items-center justify-between gap-3" data-testid={`row-product-${p.id}`}>
                        <div>
                          <p className="text-sm font-medium text-foreground">{p.product_name ?? "—"}</p>
                          {(p.quantity != null || p.unit) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Qty: {p.quantity ?? "—"} {p.unit ?? ""}
                            </p>
                          )}
                        </div>
                        {p.line_status && (
                          <Badge variant="outline" className="shrink-0 text-xs">{p.line_status}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
