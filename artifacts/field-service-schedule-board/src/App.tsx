import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalendarRange } from "lucide-react";
import ScheduleBoard from "@/pages/ScheduleBoard";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      refetchInterval: 30_000,
    },
  },
});

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center gap-2 px-6 py-4 border-b border-border bg-sidebar text-sidebar-foreground">
        <CalendarRange className="h-5 w-5 text-sidebar-primary" />
        <span className="font-semibold tracking-tight">Field Service Schedule Board</span>
      </header>
      <main className="flex-1 min-w-0 px-6 py-6">{children}</main>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={ScheduleBoard} />
        <Route path="/schedule-board" component={ScheduleBoard} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
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
