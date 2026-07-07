import type { ReactNode } from "react";
import { Database, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/useAuth";

function MicrosoftLogo() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 23 23"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export function LoginGate({ children }: { children: ReactNode }) {
  const { status, login, popupBlocked } = useAuth();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Spinner className="h-5 w-5" />
          <span className="text-sm">Checking your sign-in…</span>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-center gap-2 text-card-foreground">
            <Database className="h-5 w-5 text-primary" />
            <span className="font-semibold tracking-tight">Dynamics Write Back</span>
          </div>

          <div className="mt-6 flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-card-foreground">
              Sign in required
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This workspace is restricted to authorized users. Sign in with your
              Microsoft work account to continue.
            </p>
          </div>

          <Button className="mt-6 w-full gap-2" onClick={login}>
            <MicrosoftLogo />
            Sign in with Microsoft
          </Button>

          {popupBlocked && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              Your browser blocked the sign-in tab. Microsoft sign-in can't run
              inside an embedded preview.{" "}
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                Open this app in a new tab
              </a>{" "}
              and sign in there.
            </p>
          )}

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Protected by Microsoft Entra ID
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
