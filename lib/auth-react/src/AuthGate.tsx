import { useEffect, useState, type ReactNode } from "react";

export interface CurrentUser {
  entraOid: string;
  email?: string;
  displayName?: string;
  role: string;
}

export interface AuthGateProps {
  children: ReactNode;
  /** Name shown on the sign-in screen, e.g. "Field Service Schedule Board". */
  appName?: string;
}

type Status =
  | { kind: "loading" }
  | { kind: "authed"; user: CurrentUser }
  | { kind: "anon" }
  | { kind: "error" };

function buildLoginUrl(): string {
  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search + window.location.hash,
  );
  return `/api/login?returnTo=${returnTo}`;
}

const screenStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0f172a",
  color: "#e2e8f0",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  padding: "24px",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "360px",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "12px",
  padding: "32px",
  textAlign: "center",
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
};

const buttonStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: "20px",
  padding: "10px 20px",
  background: "#2563eb",
  color: "#ffffff",
  borderRadius: "8px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "14px",
};

/**
 * Wraps an app and only renders its children when the current browser session
 * is authenticated against the API server (`GET /api/me`). Unauthenticated
 * users get a sign-in screen that kicks off the Azure (Entra) login flow and
 * returns them to where they started.
 */
export function AuthGate({ children, appName }: AuthGateProps): ReactNode {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/me", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (res.ok) {
          const user = (await res.json()) as CurrentUser;
          if (!cancelled) setStatus({ kind: "authed", user });
        } else if (res.status === 401 || res.status === 403) {
          setStatus({ kind: "anon" });
        } else {
          setStatus({ kind: "error" });
        }
      } catch {
        if (!cancelled) setStatus({ kind: "error" });
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "authed") {
    return children;
  }

  if (status.kind === "loading") {
    return (
      <div style={screenStyle}>
        <div style={{ opacity: 0.7, fontSize: "14px" }}>Loading…</div>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div style={screenStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: "16px", fontWeight: 600 }}>
            Unable to verify your session
          </div>
          <div style={{ marginTop: "8px", fontSize: "13px", opacity: 0.75 }}>
            Please check your connection and try again.
          </div>
          <a href={buildLoginUrl()} style={buttonStyle}>
            Retry sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={screenStyle}>
      <div style={cardStyle}>
        {appName ? (
          <div style={{ fontSize: "13px", opacity: 0.6, marginBottom: "6px" }}>
            {appName}
          </div>
        ) : null}
        <div style={{ fontSize: "20px", fontWeight: 700 }}>Sign in required</div>
        <div style={{ marginTop: "8px", fontSize: "13px", opacity: 0.75 }}>
          Use your organization account to continue.
        </div>
        <a href={buildLoginUrl()} style={buttonStyle}>
          Sign in with Microsoft
        </a>
      </div>
    </div>
  );
}
