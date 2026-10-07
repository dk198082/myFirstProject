import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionUser {
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "error"; message: string }
  | { status: "signedIn"; user: SessionUser };

const BASE = import.meta.env.BASE_URL;

export function loginUrl() {
  return `/api/login?returnTo=${encodeURIComponent(BASE)}`;
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
  const seq = useRef(0);

  const check = useCallback(async (silent = false) => {
    const id = ++seq.current;
    if (!silent) setState({ status: "loading" });
    try {
      const res = await fetch("/api/me", { credentials: "include", headers: { Accept: "application/json" } });
      if (id !== seq.current) return;
      if (res.status === 401) return setState({ status: "signedOut" });
      if (!res.ok) return setState({ status: "error", message: `Session check failed (HTTP ${res.status}).` });
      const body = (await res.json()) as SessionUser & { user?: SessionUser };
      if (id !== seq.current) return;
      setState({ status: "signedIn", user: body.user ?? body });
    } catch {
      if (id !== seq.current) return;
      setState({ status: "error", message: "Could not reach the server. Check your connection." });
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
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [check]);

  const expire = useCallback(() => {
    seq.current++;
    setState({ status: "signedOut" });
  }, []);

  return { state, check, expire };
}
