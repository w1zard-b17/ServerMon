import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import Layout from "./components/Layout";
import Login from "./pages/Login";
import Hosts from "./pages/Hosts";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
import { FleetProvider, SessionProvider, ThemeProvider, ToastProvider, useSession } from "./lib/context";

// heavy pages load on demand
const Overview = lazy(() => import("./pages/Overview"));
const HostDetail = lazy(() => import("./pages/HostDetail"));
const Graph = lazy(() => import("./pages/Graph"));
const Shell = lazy(() => import("./pages/Shell"));

function Loading() {
  return <div className="skeleton" style={{ height: 420 }} />;
}

function Gate() {
  const { session } = useSession();
  if (!session) return null;
  if (!session.authenticated) return <Login />;
  return (
    <FleetProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="hosts" element={<Hosts />} />
            <Route path="hosts/:name" element={<HostDetail />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="graph" element={<Graph />} />
            <Route path="shell" element={<Shell />} />
            <Route path="shell/:name" element={<Shell />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Overview />} />
          </Route>
        </Routes>
      </Suspense>
    </FleetProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <SessionProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
