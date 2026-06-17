import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ResourceUtilization from "@/pages/ResourceUtilization";
import Dashboard from "@/pages/Dashboard";

export default function ServiceReports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Service Reports</h1>
        <p className="text-sm text-muted-foreground">
          Resource utilization and service-order dashboards in one place.
        </p>
      </div>

      <Tabs defaultValue="utilization" className="space-y-4">
        <TabsList>
          <TabsTrigger value="utilization">Utilization</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="utilization">
          <ResourceUtilization />
        </TabsContent>
        <TabsContent value="dashboard">
          <Dashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
