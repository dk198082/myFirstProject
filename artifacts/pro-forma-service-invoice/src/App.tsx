import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "@workspace/production-priority-design-system/hooks/use-toast";
import { Button } from "@workspace/production-priority-design-system/components/ui/button";
import { Toaster } from "@workspace/production-priority-design-system/components/ui/toaster";
import { Skeleton } from "@workspace/production-priority-design-system/components/ui/skeleton";
import { FileText, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import { Route, Switch, Router as WouterRouter } from "wouter";
import { startLogin, useSession } from "@/lib/auth";
import Workspace from "@/pages/workspace";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-sm border border-primary/50 bg-primary/10 text-primary">
        <FileText className="h-5 w-5" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tinius Olsen Service</div>
        <div className="text-sm font-bold text-foreground">Pro Forma Service Invoice</div>
      </div>
    </div>
  );
}

function Gate() {
  const { state, check, expire, logout, logoutHref } = useSession();
  const userKey = state.status === "signedIn" ? `${state.user.entraOid ?? state.user.email}:${state.user.role}` : state.status;
  useEffect(() => { queryClient.clear(); }, [userKey]);

  if (state.status === "loading") {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col gap-4 p-6" aria-busy="true" aria-label="Checking session">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (state.status !== "signedIn") {
    const isErr = state.status === "error";
    const isDenied = state.status === "denied";
    return (
      <main className="grid min-h-[100dvh] place-items-center p-6">
        <section className="w-full max-w-md rounded-sm border border-border bg-card p-8 shadow-sm" aria-labelledby="signin-title">
          <Brand />
          <div className="my-6 h-px bg-border" />
          <h1 id="signin-title" className="text-xl font-bold text-foreground">
            {isErr ? "Session unavailable" : isDenied ? "Invoice access not granted" : "Sign in to continue"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground" data-testid="text-auth-message">
            {isErr || isDenied
              ? state.message
              : "Use your Tinius Olsen Microsoft account. This workspace reads CRM proposals only — nothing is written back."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {isErr || isDenied ? (
              <Button onClick={() => void check()} data-testid="button-retry-session">
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            ) : (
              <Button onClick={startLogin} data-testid="button-sign-in">
                <LogIn className="mr-2 h-4 w-4" /> Sign in with Microsoft
              </Button>
            )}
            {!isErr && !isDenied && (
              <Button variant="ghost" onClick={() => void check()} data-testid="button-recheck-session">
                I have signed in
              </Button>
            )}
            {(isDenied || isErr) && <Button variant="ghost" onClick={() => void logout().catch(() => toast({ title: "Sign out failed", description: "Please retry.", variant: "destructive" }))}>Sign out / change account</Button>}
          </div>
          {logoutHref && <a href={logoutHref} target="_blank" rel="noopener noreferrer" className="mt-4 block text-sm underline">Complete Microsoft sign-out</a>}
          <p className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> If sign-in opens in a new tab, return here — this page refreshes automatically.
          </p>
        </section>
      </main>
    );
  }

  return (
    <Switch>
      <Route path="/">
        <Workspace key={userKey} user={state.user} onUnauthorized={expire}
          onAccessCheck={() => check(true)} onSignOut={logout} brand={<Brand />} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <div className="dark min-h-[100dvh] bg-background text-foreground">
          <Gate />
        </div>
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
