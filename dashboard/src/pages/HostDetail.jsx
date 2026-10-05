import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronRight, Server, Cpu, MemoryStick, HardDrive, Thermometer, Zap, CircleAlert, CheckCircle2 } from "lucide-react";
import HostActions from "../components/HostActions";
import TrendChart from "../components/TrendChart";
import Terminal from "../components/Terminal";
import Bear from "../components/Bear";
import { SeverityPill, StatePill } from "../components/Status";
import { useApi, useFleet } from "../lib/context";
import { ago, dateTime, num, uptime } from "../lib/format";

const RANGES = [
  [6, "6h"],
  [24, "24h"],
  [72, "3d"],
  [168, "7d"],
];

function ChartCard({ icon: Icon, title, now, children }) {
  return (
    <div className="card chart-card">
      <div className="head">
        <h3 className="row" style={{ gap: 7 }}><Icon size={15} className="muted" /> {title}</h3>
        <span className="now num">{now}</span>
      </div>
      {children}
    </div>
  );
}

function Trends({ name, thresholds }) {
  const [hours, setHours] = useState(24);
  const { data } = useApi(`/api/hosts/${name}/trends?hours=${hours}`, [], { poll: 60000 });

  const charts = useMemo(() => {
    if (!data) return null;
    const sys = data.system.map((p) => ({ ...p, t: new Date(p.t).getTime() }));
    const temp = data.temperature.map((p) => ({ ...p, t: new Date(p.t).getTime() }));
    // up to four filesystems that went above 5%, fullest first
    const mounts = [...new Set(sys.flatMap((p) => Object.keys(p.disks)))]
      .map((m) => ({ m, peak: Math.max(...sys.map((p) => p.disks[m] ?? 0)) }))
      .filter((x) => x.peak > 5)
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 4)
      .map((x) => x.m);
    const devices = [...new Set(temp.flatMap((p) => Object.keys(p.sensors)))];
    return {
      load: [{ key: "load1", label: "Load (1m)", points: sys.map((p) => ({ t: p.t, v: p.load1 })) }],
      memory: [
        { key: "mem", label: "Memory", points: sys.map((p) => ({ t: p.t, v: p.memory })) },
        { key: "swap", label: "Swap", points: sys.map((p) => ({ t: p.t, v: p.swap })) },
      ],
      disks: mounts.map((m) => ({ key: m, label: m, points: sys.map((p) => ({ t: p.t, v: p.disks[m] ?? null })) })),
      temps: devices.map((d) => ({ key: d, label: d, points: temp.map((p) => ({ t: p.t, v: p.sensors[d] ?? null })) })),
      last: sys[sys.length - 1],
      lastTemp: temp[temp.length - 1],
    };
  }, [data]);

  return (
    <>
      <div className="filters">
        <div className="segmented">
          {RANGES.map(([h, l]) => (
            <button key={h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>{l}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>System metrics and temperatures are sampled hourly (medium tier).</span>
      </div>
      {!charts ? (
        <div className="skeleton" style={{ height: 420 }} />
      ) : (
        <div className="chart-grid">
          <ChartCard icon={Cpu} title="CPU load" now={num(charts.last?.load1, 2)}>
            <TrendChart series={charts.load} digits={2} />
          </ChartCard>
          <ChartCard icon={MemoryStick} title="Memory" now={num(charts.last?.memory, 0, "%")}>
            <TrendChart series={charts.memory} yMax={100} unit="%" threshold={{ value: thresholds.memory_warning, label: `warn ${thresholds.memory_warning}%` }} />
          </ChartCard>
          <ChartCard icon={HardDrive} title="Disk usage" now={charts.disks[0] ? `${charts.last?.disks[charts.disks[0].key] ?? "-"}%` : "-"}>
            <TrendChart series={charts.disks} yMax={100} unit="%" threshold={{ value: thresholds.disk_warning, label: `warn ${thresholds.disk_warning}%` }} />
          </ChartCard>
          <ChartCard icon={Thermometer} title="Temperature" now={charts.temps.length ? `${Math.max(...Object.values(charts.lastTemp?.sensors || { x: 0 }))}°C` : "no sensors"}>
            {charts.temps.length ? (
              <TrendChart series={charts.temps} unit="°C" digits={1} threshold={{ value: thresholds.cpu_temp_warning, label: `cpu warn ${thresholds.cpu_temp_warning}°` }} />
            ) : (
              <div className="empty" style={{ height: 170 }}>This host exposes no temperature sensors.</div>
            )}
          </ChartCard>
        </div>
      )}
    </>
  );
}

function AlertGroups({ groups }) {
  if (!groups.length)
    return (
      <div className="card empty">
        <Bear size={46} mood="sleepy" />
        No alerts for this host in the last 7 days.
      </div>
    );
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr><th>Severity</th><th>Alert</th><th>Category</th><th className="num">Seen</th><th>Last</th><th>Status</th></tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} className={g.active ? "" : "inactive"}>
              <td><SeverityPill severity={g.severity} /></td>
              <td>{g.message}</td>
              <td className="muted">{g.category}</td>
              <td className="num">{g.count}</td>
              <td className="muted">{ago(g.last_seen)}</td>
              <td>{g.active ? <span className={`pill tone-${g.severity}`}><CircleAlert size={12} /> active</span> : <span className="pill tone-ok"><CheckCircle2 size={12} /> cleared</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ items }) {
  const icon = (type) => (type.startsWith("alert_") ? `tone-${type.slice(6)}` : type === "connection_failed" ? "tone-critical" : type === "action_failed" ? "tone-critical" : "tone-accent");
  return (
    <div className="card">
      <ul className="timeline">
        {items.map((e) => (
          <li key={e.id}>
            <span className="when">{dateTime(e.recorded_at)}</span>
            <span className={`dot ${icon(e.type)}`} style={{ marginTop: 7 }} />
            <span>
              <span className="muted mono" style={{ fontSize: 11.5 }}>{e.type}</span> {e.description}
            </span>
          </li>
        ))}
        {!items.length && <li className="muted">No events in the last 7 days.</li>}
      </ul>
    </div>
  );
}

export default function HostDetail() {
  const { name } = useParams();
  const { fleet } = useFleet();
  const summary = fleet?.hosts.find((h) => h.name === name);
  const { data, error, reload } = useApi(`/api/hosts/${name}`, [summary?.last_ok, summary?.last_fail]);
  const [tab, setTab] = useState("metrics");
  const [shellOpened, setShellOpened] = useState(false);

  if (error?.status === 404) return <div className="empty"><Bear size={56} mood="sleepy" />No host called "{name}" in the inventory.</div>;
  if (!data) return <div className="skeleton" style={{ height: 480 }} />;

  const m = data.metrics;
  const svc = data.data["services.check"];
  const active = data.alert_groups.filter((g) => g.active).length;
  const openTab = (t) => {
    setTab(t);
    if (t === "shell") setShellOpened(true);
  };

  return (
    <>
      <div className="crumbs">
        <Link to="/hosts">Hosts</Link> <ChevronRight size={13} /> <span>{name}</span>
      </div>

      <section className={`card host-hero tone-${data.state}`}>
        <div className="big-dot"><Server size={22} /></div>
        <div>
          <div className="row">
            <h1>{data.name}</h1>
            <StatePill state={data.state} />
          </div>
          <div className="muted mono" style={{ fontSize: 12.5 }}>
            {data.ip} · {data.role || "host"} · OpenBSD {m.os_release ?? "?"}
          </div>
        </div>
        <div className="hero-stats">
          <div>Uptime<b>{uptime(m.boot_time)}</b></div>
          <div>Load<b className="num">{num(m.load1, 2)}</b></div>
          <div>Memory<b className="num">{num(m.memory_percent, 0, "%")}</b></div>
          <div>Last seen<b>{ago(data.last_ok)}</b></div>
        </div>
        <div style={{ flexBasis: "100%" }}>
          <HostActions host={data} services={svc?.enabled_services || []} failed={svc?.failed_services || []} onDone={reload} />
        </div>
      </section>

      <div className="tabs" role="tablist">
        {[
          ["metrics", "Metrics"],
          ["alerts", `Alerts${active ? ` · ${active}` : ""}`],
          ["activity", "Activity"],
          ["shell", "Terminal"],
        ].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => openTab(k)}>
            {k === "shell" && <Zap size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
            {l}
          </button>
        ))}
      </div>

      {tab === "metrics" && <Trends name={name} thresholds={fleet?.overview.thresholds || {}} />}
      {tab === "alerts" && <AlertGroups groups={data.alert_groups} />}
      {tab === "activity" && <Timeline items={data.timeline} />}
      {/* the terminal stays mounted so switching tabs keeps the session */}
      {shellOpened && (
        <div className="card term-panel" style={{ height: "62dvh", display: tab === "shell" ? "flex" : "none" }}>
          {data.control ? (
            <Terminal host={name} active={tab === "shell"} />
          ) : (
            <div className="empty" style={{ color: "#8c9a93" }}>
              Shell needs an admin identity: set <code>admin_user</code> for {name} in hosts.yaml and place <code>{name}.admin.key</code> on the monitoring host.
            </div>
          )}
        </div>
      )}
    </>
  );
}
