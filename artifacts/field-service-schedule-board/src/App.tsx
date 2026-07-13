import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { CalendarRange, UploadCloud, LogOut } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LoginGate } from "@/components/LoginGate";
import ScheduleBoard from "@/pages/ScheduleBoard";
import Writebacks from "@/pages/Writebacks";
import WorkOrderDetail from "@/pages/WorkOrderDetail";
import ServiceLocationDetail from "@/pages/ServiceLocationDetail";
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

function HeaderUser() {
  const { user, logout } = useAuth();

  const displayName = user?.displayName ?? user?.email ?? "Signed in";
  const initials = (user?.displayName ?? user?.email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="ml-auto flex items-center gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-semibold text-sidebar-primary">
          {initials || "?"}
        </div>
        <div className="hidden min-w-0 sm:block">
          <div className="truncate text-sm font-medium text-sidebar-foreground">
            {displayName}
          </div>
          {user?.email && user.email !== displayName ? (
            <div className="truncate text-xs text-sidebar-foreground/60">
              {user.email}
            </div>
          ) : (
            <div className="truncate text-xs capitalize text-sidebar-foreground/60">
              {user?.role}
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        onClick={logout}
      >
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
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
        </nav>
        <HeaderUser />
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
        <Route path="/service-location/:id" component={ServiceLocationDetail} />
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
