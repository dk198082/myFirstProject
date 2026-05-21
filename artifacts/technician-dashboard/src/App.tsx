import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import WorkOrderDetail from "@/pages/WorkOrderDetail";
import ScheduledJobs from "@/pages/ScheduledJobs";
import JobsByRegion from "@/pages/JobsByRegion";
import ScheduleBoard from "@/pages/ScheduleBoard";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/scheduled-jobs" component={ScheduledJobs} />
      <Route path="/jobs-by-region" component={JobsByRegion} />
      <Route path="/schedule-board" component={ScheduleBoard} />
      <Route path="/work-order/:id" component={WorkOrderDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
