import { Link, useParams } from "wouter";
import { useGetWbServiceLocation } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, MapPin, Phone, Mail, User, Package, AlertTriangle
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

export default function ServiceLocationDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: loc, isLoading, error } = useGetWbServiceLocation(id!, {
    query: { queryKey: ["getWbServiceLocation", id], enabled: !!id },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link
            href="/"
            data-testid="link-back"
            className="flex items-center gap-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm font-medium">Back</span>
          </Link>
          <span className="text-sidebar-foreground/40 mx-1">|</span>
          <h1 className="text-xl font-bold tracking-tight">Service Location</h1>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm p-4 rounded-md border border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {(error as { response?: { status?: number } })?.response?.status === 404
                ? "Service location not found."
                : "Failed to load service location details. The CRM may be unavailable."}
            </span>
          </div>
        )}

        {loc && (
          <>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">{loc.name}</h2>
              {(loc.city || loc.state) && (
                <div className="flex items-center gap-1.5 mt-1 text-muted-foreground text-sm">
                  <MapPin className="h-4 w-4" />
                  {[loc.address, loc.city, loc.state, loc.postal_code, loc.country]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Row label="Name" value={loc.name} />
                  <Row label="Address" value={loc.address} />
                  <Row label="City" value={loc.city} />
                  <Row label="State" value={loc.state} />
                  <Row label="Postal Code" value={loc.postal_code} />
                  <Row label="Country" value={loc.country} />
                  {loc.phone && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 py-2 border-b border-border">
                      <span className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">Phone</span>
                      <a href={`tel:${loc.phone}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {loc.phone}
                      </a>
                    </div>
                  )}
                  {loc.email && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 py-2 border-b border-border last:border-0">
                      <span className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">Email</span>
                      <a href={`mailto:${loc.email}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {loc.email}
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>

              {loc.contact && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Primary Contact
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Row label="Name" value={loc.contact.fullname} />
                    <Row label="First Name" value={loc.contact.firstname} />
                    <Row label="Last Name" value={loc.contact.lastname} />
                    {loc.contact.email && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 py-2 border-b border-border">
                        <span className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">Email</span>
                        <a href={`mailto:${loc.contact.email}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {loc.contact.email}
                        </a>
                      </div>
                    )}
                    {loc.contact.businessphone && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 py-2 border-b border-border">
                        <span className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">Business Phone</span>
                        <a href={`tel:${loc.contact.businessphone}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {loc.contact.businessphone}
                        </a>
                      </div>
                    )}
                    {loc.contact.mobilephone && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 py-2 border-b border-border last:border-0">
                        <span className="text-sm font-medium text-muted-foreground sm:w-40 shrink-0">Mobile</span>
                        <a href={`tel:${loc.contact.mobilephone}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {loc.contact.mobilephone}
                        </a>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {loc.equipment.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Equipment ({loc.equipment.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {loc.equipment.map((eq) => (
                      <div key={eq.equipmentid} className="border rounded-md p-3 space-y-1">
                        <div className="font-medium text-sm">{eq.name ?? "—"}</div>
                        {eq.serialnumber && (
                          <div className="text-xs text-muted-foreground">S/N: {eq.serialnumber}</div>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                          {eq.lastcalibrationdate && (
                            <span className="text-xs text-muted-foreground">
                              Last cal: {eq.lastcalibrationdate}
                            </span>
                          )}
                          {eq.nextcalibrationdate && (
                            <span className="text-xs text-muted-foreground">
                              Next cal: {eq.nextcalibrationdate}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {loc.equipment.length === 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Equipment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">No equipment found for this service location.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
