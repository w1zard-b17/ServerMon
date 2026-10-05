import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CircleAlert, Search, Share2 } from "lucide-react";
import Bear from "../components/Bear";
import { SeverityIcon, SeverityPill } from "../components/Status";
import { useApi, useFleet } from "../lib/context";
import { ago, dateTime } from "../lib/format";

const RANGES = [
  [24, "24h"],
  [168, "7d"],
  [720, "30d"],
];

export default function Alerts() {
  const [hours, setHours] = useState(168);
  const [severity, setSeverity] = useState(new Set(["critical", "warning", "info"]));
  const [host, setHost] = useState("");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const { fleet } = useFleet();
  const { data } = useApi(`/api/alerts?hours=${hours}`, [fleet?.overview.generated_at]);

  const groups = useMemo(
    () =>
      (data?.groups || []).filter(
        (g) =>
          severity.has(g.severity) &&
          (!host || g.host === host) &&
          (status === "all" || (status === "active") === g.active) &&
          (!query || `${g.message} ${g.category} ${g.host}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [data, severity, host, status, query],
  );

  const toggleSeverity = (s) => {
    const next = new Set(severity);
    next.has(s) ? next.delete(s) : next.add(s);
    setSeverity(next);
  };

  const counts = (data?.groups || []).reduce((acc, g) => ((acc[g.severity] = (acc[g.severity] || 0) + 1), acc), {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>Repeated findings are grouped. Each row is one problem and how often it was seen.</p>
        </div>
        <Link to="/graph" className="btn"><Share2 size={15} /> View as graph</Link>
      </div>

      <div className="filters">
        <div className="segmented">
          {RANGES.map(([h, l]) => (
            <button key={h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>{l}</button>
          ))}
        </div>
        {["critical", "warning", "info"].map((s) => (
          <button key={s} className={`chip ${severity.has(s) ? "on" : ""}`} onClick={() => toggleSeverity(s)} aria-pressed={severity.has(s)}>
            <SeverityIcon severity={s} size={13} /> {s} <span className="muted num">{counts[s] || 0}</span>
          </button>
        ))}
        <div className="segmented">
          {[["all", "All"], ["active", "Active"], ["cleared", "Cleared"]].map(([k, l]) => (
            <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <select className="select" value={host} onChange={(e) => setHost(e.target.value)} aria-label="Host">
          <option value="">All hosts</option>
          {fleet?.hosts.map((h) => <option key={h.name} value={h.name}>{h.name}</option>)}
        </select>
        <div className="row" style={{ position: "relative" }}>
          <Search size={15} className="muted" style={{ position: "absolute", left: 11 }} />
          <input className="input" style={{ paddingLeft: 32, width: 200 }} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {!data ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : groups.length ? (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Severity</th><th>Host</th><th>Alert</th><th>Category</th><th className="num">Occurrences</th><th>First seen</th><th>Last seen</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className={g.active ? "" : "inactive"}>
                  <td><SeverityPill severity={g.severity} /></td>
                  <td><Link to={`/hosts/${g.host}`} style={{ fontWeight: 600 }}>{g.host}</Link></td>
                  <td>{g.message}</td>
                  <td className="muted">{g.category}</td>
                  <td className="num">{g.count}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{dateTime(g.first_seen)}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }} title={dateTime(g.last_seen)}>{ago(g.last_seen)}</td>
                  <td>
                    {g.active ? (
                      <span className={`pill tone-${g.severity}`}><CircleAlert size={12} /> active</span>
                    ) : (
                      <span className="pill tone-ok"><CheckCircle2 size={12} /> cleared</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">
          <Bear size={52} mood="sleepy" />
          No alerts match these filters.
        </div>
      )}
    </>
  );
}
