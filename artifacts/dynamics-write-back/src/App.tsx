import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Database, ClipboardList, CalendarRange } from "lucide-react";
import WorkOrders from "@/pages/WorkOrders";
import Writebacks from "@/pages/Writebacks";
import ScheduleBoard from "@/pages/ScheduleBoard";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 30_000 },
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
    <div className="min-h-screen bg-background">
      <header className="bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-sidebar-primary" />
            <span className="font-semibold tracking-tight">Dynamics Write Back</span>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink href="/">
              <span className="inline-flex items-center gap-1.5">
                <ClipboardList className="h-4 w-4" /> Work Orders
              </span>
            </NavLink>
            <NavLink href="/schedule-board">
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange className="h-4 w-4" /> Schedule Board
              </span>
            </NavLink>
            <NavLink href="/writebacks">Queued Write-backs</NavLink>
          </nav>
          <div className="ml-auto text-xs text-sidebar-foreground/60">
            Reads <span className="text-sidebar-foreground/80">d365crm</span> · Stages locally
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={WorkOrders} />
        <Route path="/schedule-board" component={ScheduleBoard} />
        <Route path="/writebacks" component={Writebacks} />
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
