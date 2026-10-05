import { LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { useFleet, useSession, useTheme } from "../lib/context";
import { ago } from "../lib/format";

export default function Settings() {
  const { theme, toggle } = useTheme();
  const { session, logout } = useSession();
  const { fleet } = useFleet();
  const th = fleet?.overview.thresholds || {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Appearance, session and the monitoring configuration this dashboard reads.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="card card-pad stack">
          <h2>Appearance</h2>
          <div className="segmented" style={{ alignSelf: "flex-start" }}>
            <button className={theme === "dark" ? "on" : ""} onClick={() => theme !== "dark" && toggle()}><Moon size={13} style={{ verticalAlign: -2 }} /> Dark</button>
            <button className={theme === "light" ? "on" : ""} onClick={() => theme !== "light" && toggle()}><Sun size={13} style={{ verticalAlign: -2 }} /> Light</button>
          </div>
        </section>

        <section className="card card-pad stack">
          <h2 className="row"><ShieldCheck size={16} /> Session</h2>
          <dl className="kv">
            <dt>Sign-in</dt><dd>Authenticator app (TOTP)</dd>
            <dt>Privileged actions</dt>
            <dd>{session?.elevated_until ? `unlocked until ${new Date(session.elevated_until * 1000).toLocaleTimeString()}` : "locked, asks for a code"}</dd>
            <dt>Access</dt><dd>LAN only</dd>
          </dl>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Lost your phone? On the monitoring host run <code>python -m api.auth reset</code>, restart the API and enrol again with the new console token.
          </p>
          <button className="btn" style={{ alignSelf: "flex-start" }} onClick={logout}><LogOut size={15} /> Lock dashboard</button>
        </section>

        <section className="card card-pad stack">
          <h2>Alert thresholds</h2>
          <dl className="kv">
            <dt>Disk warning / critical</dt><dd>{th.disk_warning}% / {th.disk_critical}%</dd>
            <dt>Memory warning</dt><dd>{th.memory_warning}%</dd>
            <dt>CPU temperature warning</dt><dd>{th.cpu_temp_warning}°C</dd>
            <dt>Disk temperature warning</dt><dd>{th.disk_temp_warning}°C</dd>
          </dl>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Defined in <code>config/constants.py</code>; the engine applies them each cycle.</p>
        </section>

        <section className="card card-pad stack">
          <h2>Collection cycles</h2>
          <dl className="kv">
            {fleet && Object.entries(fleet.overview.tiers).map(([k, t]) => (
              <FragmentRow key={k} k={k} t={t} />
            ))}
          </dl>
        </section>

        <section className="card table-wrap" style={{ gridColumn: "1 / -1" }}>
          <div className="card-head"><h2>Inventory</h2><span className="sub">config/hosts.yaml</span></div>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Host</th><th>Address</th><th>Role</th><th>Tiers</th><th>Control</th><th>First seen</th></tr></thead>
            <tbody>
              {fleet?.hosts.map((h) => (
                <tr key={h.name}>
                  <td><strong>{h.name}</strong></td>
                  <td className="mono">{h.ip}</td>
                  <td>{h.role || "-"}</td>
                  <td className="muted">{h.tiers.join(", ")}</td>
                  <td>{h.control ? <span className="pill tone-ok">enabled</span> : <span className="pill tone-offline">read-only</span>}</td>
                  <td className="muted">{ago(h.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function FragmentRow({ k, t }) {
  const every = t.every_seconds >= 3600 ? `${t.every_seconds / 3600}h` : `${t.every_seconds / 60}m`;
  return (
    <>
      <dt>{k} · every {every}</dt>
      <dd>last {ago(t.last_run)}</dd>
    </>
  );
}
