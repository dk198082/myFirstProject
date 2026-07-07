import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Database, ClipboardList, CalendarRange, Globe, CalendarClock, FileBarChart, LogOut } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LoginGate } from "@/components/LoginGate";
import Dashboard from "@/pages/Dashboard";
import ServiceReports from "@/pages/ServiceReports";
import WorkOrders from "@/pages/WorkOrders";
import Writebacks from "@/pages/Writebacks";
import ScheduleBoard from "@/pages/ScheduleBoard";
import JobsByRegion from "@/pages/JobsByRegion";
import Unscheduled from "@/pages/Unscheduled";
import ResourceUtilization from "@/pages/ResourceUtilization";
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
      className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
      }`}
    >
      {children}
    </Link>
  );
}

function SidebarUser() {
  const { user, logout } = useAuth();

  const displayName = user?.displayName ?? user?.email ?? "Signed in";
  const initials = (user?.displayName ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-semibold text-sidebar-primary">
          {initials || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-sidebar-foreground">
            {displayName}
          </div>
          {user?.email && user.email !== displayName ? (
            <div className="truncate text-xs text-sidebar-foreground/60">{user.email}</div>
          ) : (
            <div className="truncate text-xs text-sidebar-foreground/60 capitalize">
              {user?.role}
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
        onClick={logout}
      >
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col h-screen sticky top-0 self-start overflow-y-auto">
        <div className="flex items-center gap-2 px-4 py-4 border-b border-sidebar-border">
          <Database className="h-5 w-5 text-sidebar-primary" />
          <span className="font-semibold tracking-tight">Dynamics Write Back</span>
        </div>
        <nav className="flex flex-col gap-1 p-3 flex-1">
          <NavLink href="/">
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange className="h-4 w-4" /> Schedule Board
            </span>
          </NavLink>
          <NavLink href="/jobs-by-region">
            <span className="inline-flex items-center gap-1.5">
              <Globe className="h-4 w-4" /> By Region
            </span>
          </NavLink>
          <NavLink href="/unscheduled">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4" /> Unscheduled
            </span>
          </NavLink>
          <NavLink href="/work-orders">
            <span className="inline-flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4" /> Work Orders
            </span>
          </NavLink>
          <NavLink href="/service-reports">
            <span className="inline-flex items-center gap-1.5">
              <FileBarChart className="h-4 w-4" /> Service Reports
            </span>
          </NavLink>
          <NavLink href="/writebacks">Queued Write-backs</NavLink>
        </nav>
        <SidebarUser />
      </aside>
      <main className="flex-1 min-w-0 px-6 py-6">{children}</main>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={ScheduleBoard} />
        <Route path="/service-reports" component={ServiceReports} />
        <Route path="/utilization" component={ResourceUtilization} />
        <Route path="/jobs-by-region" component={JobsByRegion} />
        <Route path="/unscheduled" component={Unscheduled} />
        <Route path="/work-orders" component={WorkOrders} />
        <Route path="/work-order/:id" component={WorkOrderDetail} />
        <Route path="/dashboard" component={Dashboard} />
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
        <AuthProvider>
          <LoginGate>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </LoginGate>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
