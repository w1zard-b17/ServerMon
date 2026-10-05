import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, Search, Thermometer, ShieldCheck, ShieldOff, Package } from "lucide-react";
import HostActions from "../components/HostActions";
import { Meter, SeverityIcon, StatePill } from "../components/Status";
import { useApi, useFleet } from "../lib/context";
import { COLLECTOR_LABEL, ago, level, num, uptime } from "../lib/format";

function Metric({ label, value, pct, tone, extra }) {
  return (
    <div className="metric">
      <div className="k"><span>{label}</span>{extra && <span>{extra}</span>}</div>
      <div className="v">{value}</div>
      {pct !== undefined && <Meter value={pct} tone={tone} />}
    </div>
  );
}

function Expanded({ host }) {
  const { data } = useApi(`/api/hosts/${host.name}`, [host.last_ok]);
  const svc = data?.data?.["services.check"];
  const pkg = data?.data?.["packages.check"];
  const disks = data?.data?.["system_metrics.check"]?.disk_usage || [];
  const temps = data?.data?.["temperature.check"];
  const th = useFleet().fleet?.overview?.thresholds || {};

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="expand-grid">
        <div className="panel">
          <h4>Disks</h4>
          <div className="stack" style={{ gap: 9 }}>
            {disks.filter((d) => d.size_kb > 0).map((d) => (
              <div key={d.mounted_on}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 12.5 }}>
                  <span className="mono">{d.mounted_on}</span>
                  <span className="num">{d.capacity_percent}%</span>
                </div>
                <Meter value={d.capacity_percent} tone={level(d.capacity_percent, th.disk_warning, th.disk_critical)} />
              </div>
            ))}
            {!disks.length && <span className="muted">No data yet</span>}
          </div>
        </div>

        <div className="panel">
          <h4>Services</h4>
          {svc ? (
            <div className="tags">
              {svc.failed_services.map((s) => <span key={s} className="tag bad">{s} (failed)</span>)}
              {svc.enabled_services.filter((s) => !svc.failed_services.includes(s)).map((s) => <span key={s} className="tag">{s}</span>)}
            </div>
          ) : <span className="muted">No data yet</span>}
        </div>

        <div className="panel">
          <h4>Security & packages</h4>
          <dl className="kv">
            <dt>Firewall</dt>
            <dd>{host.metrics.pf_enabled === false ? <span className="pill tone-critical"><ShieldOff size={12} /> pf disabled</span> : host.metrics.pf_enabled ? <span className="pill tone-ok"><ShieldCheck size={12} /> {host.metrics.pf_rules} rules</span> : "-"}</dd>
            <dt>pf states</dt><dd>{num(host.metrics.pf_states)}</dd>
            <dt>Pending patches</dt><dd>{num(host.metrics.patches_pending)}</dd>
            <dt>Outdated packages</dt><dd>{host.metrics.mirror_unreachable ? "mirror unreachable" : num(host.metrics.packages_outdated)}</dd>
            <dt>Installed</dt><dd>{pkg ? pkg.installed_packages.length : "-"}</dd>
            <dt>OpenBSD</dt><dd>{host.metrics.os_release ?? "-"}</dd>
          </dl>
        </div>

        <div className="panel">
          <h4>Collectors</h4>
          <dl className="kv">
            {Object.entries(host.collectors).map(([c, info]) => (
              <FragmentRow key={c} label={COLLECTOR_LABEL[c] || c} info={info} />
            ))}
          </dl>
          {temps && (temps.cpu.length + temps.disk.length > 0) && (
            <div className="tags" style={{ marginTop: 10 }}>
              {[...temps.cpu, ...temps.disk].map((s) => (
                <span key={s.device} className="tag"><Thermometer size={11} style={{ verticalAlign: -1 }} /> {s.device} {s.value}°</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <HostActions host={host} services={svc?.enabled_services || []} failed={svc?.failed_services || []} />
    </div>
  );
}

function FragmentRow({ label, info }) {
  return (
    <>
      <dt>{label}</dt>
      <dd title={info.message || ""}>
        {info.status === "ok" ? <span className="muted">{ago(info.recorded_at)}</span> : <span className="pill tone-critical">error</span>}
      </dd>
    </>
  );
}

function HostCard({ host, expanded, onToggle, th }) {
  const m = host.metrics;
  const alerts = host.alerts;
  return (
    <article
      className={`card host-card tone-${host.state} ${expanded ? "expanded" : ""}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle())}
    >
      <div className="title">
        <div className="grow">
          <div className="row">
            <span className="name">{host.name}</span>
            <StatePill state={host.state} />
          </div>
          <div className="meta mono">{host.ip} · {host.role || "host"}</div>
        </div>
        <Link to={`/hosts/${host.name}`} className="btn btn-sm" onClick={(e) => e.stopPropagation()}>
          Open <ArrowUpRight size={13} />
        </Link>
        <ChevronDown size={18} className="muted" style={{ transform: expanded ? "rotate(180deg)" : "", transition: "transform .2s" }} />
      </div>

      <div className="host-metrics">
        <Metric label="CPU load" value={num(m.load1, 2)} extra={`${num(m.load5, 2)} · ${num(m.load15, 2)}`} />
        <Metric label="Memory" value={num(m.memory_percent, 0, "%")} pct={m.memory_percent} tone={level(m.memory_percent, th.memory_warning)} />
        <Metric
          label="Fullest disk"
          value={m.disk_max ? `${m.disk_max.percent}%` : "-"}
          extra={m.disk_max?.mount}
          pct={m.disk_max?.percent}
          tone={level(m.disk_max?.percent, th.disk_warning, th.disk_critical)}
        />
        <Metric label="Temperature" value={m.cpu_temp != null ? `${num(m.cpu_temp, 0)}°C` : "no sensors"} extra={m.disk_temp != null ? `disk ${num(m.disk_temp, 0)}°` : null} />
      </div>

      <div className="host-foot">
        {["critical", "warning", "info"].filter((s) => alerts[s]).map((s) => (
          <span key={s} className={`pill tone-${s}`}><SeverityIcon severity={s} size={12} /> {alerts[s]}</span>
        ))}
        {m.patches_pending ? <span className="pill tone-info"><Package size={12} /> {m.patches_pending} patches</span> : null}
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>
          {host.reach === "offline" ? `down since ${ago(host.last_fail)}` : `up ${uptime(m.boot_time)} · seen ${ago(host.last_ok)}`}
        </span>
      </div>

      {expanded && <Expanded host={host} />}
    </article>
  );
}

const ORDER = { critical: 0, offline: 1, warning: 2, stale: 3, unknown: 4, ok: 5 };

export default function Hosts() {
  const { fleet } = useFleet();
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  if (!fleet) return <div className="skeleton" style={{ height: 400 }} />;
  const th = fleet.overview.thresholds;

  const hosts = fleet.hosts
    .filter((h) => filter === "all" || (filter === "attention" ? h.state !== "ok" : h.state === filter))
    .filter((h) => !query || `${h.name} ${h.ip} ${h.role}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hosts</h1>
          <p>{fleet.hosts.length} in inventory, click a card for details and actions</p>
        </div>
      </div>
      <div className="filters">
        <div className="segmented">
          {[["all", "All"], ["attention", "Needs attention"], ["ok", "Healthy"], ["offline", "Offline"]].map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="row" style={{ position: "relative" }}>
          <Search size={15} className="muted" style={{ position: "absolute", left: 11 }} />
          <input className="input" style={{ paddingLeft: 32, width: 220 }} placeholder="Search hosts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div className="host-grid">
        {hosts.map((h) => (
          <HostCard key={h.name} host={h} th={th} expanded={open === h.name} onToggle={() => setOpen(open === h.name ? null : h.name)} />
        ))}
      </div>
      {!hosts.length && <div className="empty">No hosts match.</div>}
    </>
  );
}
