import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "@workspace/auth-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalendarRange, UploadCloud } from "lucide-react";
import ScheduleBoard from "@/pages/ScheduleBoard";
import Writebacks from "@/pages/Writebacks";
import WorkOrderDetail from "@/pages/WorkOrderDetail";
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [location] = useLocation();
  const active = location === href || (href !== "/" && location.startsWith(href));
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
      }`}
    >
      {children}
    </Link>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-sidebar-primary" />
          <span className="font-semibold tracking-tight">Field Service Schedule Board</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink href="/">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="h-4 w-4" /> Schedule Board
            </span>
          </NavLink>
          <NavLink href="/writebacks">
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud className="h-4 w-4" /> Queued Write-backs
            </span>
          </NavLink>
        </nav>
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
        <Route path="/writebacks" component={Writebacks} />
        <Route path="/work-order/:id" component={WorkOrderDetail} />
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
          <AuthGate appName="Field Service Schedule Board">
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
