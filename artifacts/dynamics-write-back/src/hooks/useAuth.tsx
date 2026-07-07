import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface AuthUser {
  entraOid: string;
  email: string | undefined;
  displayName: string | undefined;
  role: string;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Auth routes live at the absolute /api prefix on the shared api-server,
// independent of this app's base path.
const ME_URL = "/api/me";
const LOGIN_URL = "/api/login";
const LOGOUT_URL = "/api/logout";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const res = await fetch(ME_URL, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as AuthUser;
          setUser(data);
          setStatus("authenticated");
        } else {
          setUser(null);
          setStatus("unauthenticated");
        }
      } catch {
        if (cancelled) return;
        setUser(null);
        setStatus("unauthenticated");
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  function login() {
    // Full-page navigation into the OAuth authorization-code flow. Bring the
    // user back to their current location within this app after login.
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `${LOGIN_URL}?returnTo=${encodeURIComponent(returnTo)}`;
  }

  function logout() {
    // POST to /logout, then send the browser to Entra's logout endpoint (the
    // server responds with a redirect that a full navigation will follow).
    const form = document.createElement("form");
    form.method = "POST";
    form.action = LOGOUT_URL;
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
