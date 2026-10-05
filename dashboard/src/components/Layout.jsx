import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Boxes, Server, Siren, Share2, TerminalSquare, Settings, Moon, Sun, LogOut, Menu } from "lucide-react";
import Bear from "./Bear";
import { ElevateModal } from "./Modals";
import { useFleet, useSession, useTheme } from "../lib/context";
import { ago } from "../lib/format";

const NAV = [
  { to: "/", label: "Overview", icon: Boxes, end: true },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/alerts", label: "Alerts", icon: Siren, badge: true },
  { to: "/graph", label: "Alert graph", icon: Share2 },
  { to: "/shell", label: "Shell", icon: TerminalSquare },
];

export default function Layout() {
  const { fleet } = useFleet();
  const { logout } = useSession();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const ov = fleet?.overview;
  const critical = ov?.alerts_active?.critical ?? 0;
  const lastFast = ov?.tiers?.fast?.last_run;

  return (
    <div className="app">
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand">
          <Bear size={36} mood={critical ? "alert" : "calm"} />
          <div>
            <div className="brand-name">ServerMon</div>
            <div className="brand-sub">fleet watch</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={17} strokeWidth={1.9} />
              {label}
              {badge && critical > 0 && <span className="count">{critical}</span>}
            </NavLink>
          ))}
          <div className="nav-label">System</div>
          <NavLink to="/settings">
            <Settings size={17} strokeWidth={1.9} />
            Settings
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          {ov && (
            <div className="fleet-mini">
              <div className="row" style={{ marginBottom: 4 }}>
                <span>Hosts online</span>
                <strong className="num">
                  {ov.hosts_online}/{ov.hosts_expected}
                </strong>
              </div>
              <div className="row">
                <span>Last check</span>
                <strong>{ago(lastFast)}</strong>
              </div>
            </div>
          )}
          <div className="foot-actions">
            <button className="btn btn-ghost grow" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Lock dashboard" title="Lock">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <button className="btn btn-icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <Bear size={26} />
          <strong>ServerMon</strong>
          <span className="spacer" />
          {critical > 0 && <span className="pill tone-critical">{critical} critical</span>}
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
      <ElevateModal />
    </div>
  );
}
