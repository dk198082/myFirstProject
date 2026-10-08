import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionUser {
  entraOid?: string;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "error"; message: string }
  | { status: "denied"; message: string }
  | { status: "signedIn"; user: SessionUser };

const BASE = import.meta.env.BASE_URL;

export function loginUrl() {
  return `/api/login?app=proforma&returnTo=${encodeURIComponent(BASE)}`;
}

export function startLogin() {
  const url = loginUrl();
  let embedded = false;
  try {
    embedded = window.top !== window.self;
  } catch {
    embedded = true;
  }
  if (embedded) {
    // noopener may return null even when the tab opened; do not navigate the
    // iframe to Microsoft as a fallback, since Microsoft forbids embedding.
    window.open(url, "_blank", "noopener");
  } else {
    window.location.href = url;
  }
}

export function useSession() {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [logoutHref, setLogoutHref] = useState<string | null>(null);
  const seq = useRef(0);

  const check = useCallback(async (silent = false) => {
    const id = ++seq.current;
    if (!silent) setState({ status: "loading" });
    try {
      const res = await fetch("/api/me?app=proforma", { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" });
      if (id !== seq.current) return null;
      if (res.status === 401) { setState({ status: "signedOut" }); return null; }
      if (res.status === 403) {
        setState({ status: "denied", message: "Your Microsoft account does not have access to Pro Forma Service Invoice. Ask your administrator to assign an invoice role in Admin Console." });
        return null;
      }
      if (!res.ok) { setState({ status: "error", message: `Invoice access could not be checked (HTTP ${res.status}). Please retry.` }); return null; }
      const body = (await res.json()) as SessionUser & { user?: SessionUser };
      if (id !== seq.current) return null;
      const user = body.user ?? body;
      setLogoutHref(null);
      setState({ status: "signedIn", user });
      return user;
    } catch {
      if (id !== seq.current) return null;
      setState({ status: "error", message: "Could not reach the server. Check your connection." });
      return null;
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Re-check on focus/visibility so a login completed in another tab is picked up.
  useEffect(() => {
    const onFocus = () => {
      void check(true);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check(true);
    }, 60000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, [check]);

  const expire = useCallback(() => {
    seq.current++;
    setState({ status: "signedOut" });
  }, []);

  const logout = useCallback(async () => {
    // Open a top-level tab during the click gesture; Microsoft cannot be framed.
    const embedded = window.top !== window.self;
    const tab = embedded ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const response = await fetch("/api/logout", { method: "POST", credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Could not sign out. Please retry.");
      const { logoutUrl } = await response.json() as { logoutUrl: string };
      expire();
      if (embedded) {
        setLogoutHref(logoutUrl);
        if (tab) tab.location.href = logoutUrl;
      } else window.location.href = logoutUrl;
    } catch (error) {
      tab?.close();
      throw error;
    }
  }, [expire]);

  return { state, check, expire, logout, logoutHref };
}
