import type { ReactNode } from "react";
import { useAuth } from "@workspace/auth-web";
import { Button } from "@/components/ui/button";
import { CalendarClock, Loader2 } from "lucide-react";

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-4 w-4" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, login } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div
          className="w-full max-w-sm rounded-xl border bg-card text-card-foreground shadow-sm p-8 flex flex-col items-center text-center gap-6"
          data-testid="screen-login"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-sidebar flex items-center justify-center">
              <CalendarClock className="h-6 w-6 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Technician Dashboard</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Sign in with your Microsoft work account to continue.
              </p>
            </div>
          </div>
          <Button
            className="w-full gap-2"
            size="lg"
            onClick={login}
            data-testid="button-login"
          >
            <MicrosoftLogo />
            Sign in with Microsoft
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
