// app state: session, fleet polling, theme and toasts

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

const POLL_MS = 15000;

// --- session ---

const SessionCtx = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [elevatePrompt, setElevatePrompt] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get("/api/auth/status"));
    } catch {
      setSession({ enrolled: true, authenticated: false, error: true });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener("servermon:unauthorized", onUnauthorized);
    return () => window.removeEventListener("servermon:unauthorized", onUnauthorized);
  }, [refresh]);

  // resolves once the session is elevated, asking for a second code if needed
  const requireElevation = useCallback(
    (reason) => {
      if (session?.elevated_until && session.elevated_until * 1000 > Date.now() + 5000) return Promise.resolve();
      return new Promise((resolve, reject) => setElevatePrompt({ resolve, reject, reason }));
    },
    [session],
  );

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setSession((s) => ({ ...s, authenticated: false, elevated: false, elevated_until: null }));
  }, []);

  const value = useMemo(
    () => ({ session, setSession, refresh, requireElevation, elevatePrompt, setElevatePrompt, logout }),
    [session, refresh, requireElevation, elevatePrompt, logout],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

// --- fleet ---

const FleetCtx = createContext(null);

export function FleetProvider({ children }) {
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef();

  const load = useCallback(async () => {
    try {
      setFleet(await api.get("/api/fleet"));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      if (!document.hidden) load();
    };
    timer.current = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  const value = useMemo(() => ({ fleet, error, reload: load }), [fleet, error, load]);
  return <FleetCtx.Provider value={value}>{children}</FleetCtx.Provider>;
}

export const useFleet = () => useContext(FleetCtx);

// --- theme ---

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("servermon-theme", theme);
    } catch {
      // storage blocked, the theme is not saved
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

// --- toasts ---

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// --- data hook ---

export function useApi(path, deps = [], { poll } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api.get(path));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [path, ...deps]);

  useEffect(() => {
    setLoading(true);
    load();
    if (!poll) return;
    const id = setInterval(() => !document.hidden && load(), poll);
    return () => clearInterval(id);
  }, [load, poll]);

  return { data, error, loading, reload: load };
}
