import { Link, useNavigate } from "react-router-dom";
import { Activity, Server, Siren, RefreshCw } from "lucide-react";
import ServerStack from "../components/ServerStack";
import Bear from "../components/Bear";
import { SeverityIcon, StateDot } from "../components/Status";
import { useFleet, useTheme } from "../lib/context";
import { ago, STATE_LABEL } from "../lib/format";

const TIER_LABEL = { fast: "Fast", medium: "Medium", slow: "Slow" };

function freshness(tier) {
  if (!tier.last_run) return { pct: 0, tone: "offline" };
  const age = (Date.now() - new Date(tier.last_run).getTime()) / 1000;
  const pct = Math.max(4, 100 - (age / tier.every_seconds) * 100);
  return { pct, tone: age > tier.every_seconds * 2 ? "warning" : "ok" };
}

function every(seconds) {
  return seconds >= 3600 ? `${seconds / 3600}h` : `${seconds / 60}m`;
}

export default function Overview() {
  const { fleet, reload } = useFleet();
  const { theme } = useTheme();
  const navigate = useNavigate();

  if (!fleet) return <div className="skeleton" style={{ height: 560 }} />;
  const { overview: ov, hosts } = fleet;

  const attention = hosts
    .flatMap((h) => (h.state === "offline" ? [{ host: h.name, severity: "critical", message: "Host unreachable", when: h.last_fail }] : []))
    .concat(
      hosts.flatMap((h) =>
        h.reach === "online" && (h.alerts.critical || h.alerts.warning)
          ? [{ host: h.name, severity: h.alerts.critical ? "critical" : "warning", message: `${h.alerts.critical} critical · ${h.alerts.warning} warning`, when: h.last_ok }]
          : [],
      ),
    );

  const byState = ov.hosts_by_state;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            {ov.hosts_online} of {ov.hosts_expected} hosts reachable, updated {ago(ov.generated_at)}
          </p>
        </div>
        <button className="btn" onClick={reload}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      <div className="overview">
        <section className="card stage" aria-label="Server stack">
          <ServerStack hosts={hosts} theme={theme} onOpen={(name) => navigate(`/hosts/${name}`)} />
          <div className="stage-legend">
            {["ok", "warning", "critical", "offline"].map((s) => (
              <span key={s}>
                <StateDot state={s} glow={s !== "offline"} />
                {STATE_LABEL[s]} <b className="num">{byState[s] ?? 0}</b>
              </span>
            ))}
          </div>
          <div className="stage-hint">Drag to orbit, click a cabinet to open it</div>
        </section>

        <div className="side-col">
          <div className="tiles">
            <div className="card tile">
              <div className="label"><Server size={13} /> Hosts online</div>
              <div className="value num">
                {ov.hosts_online}<small>/{ov.hosts_expected}</small>
              </div>
              <div className="foot">{ov.hosts_expected - ov.hosts_online ? `${ov.hosts_expected - ov.hosts_online} not responding` : "All expected hosts up"}</div>
            </div>
            <div className="card tile">
              <div className="label"><Siren size={13} /> Active alerts</div>
              <div className="value num">{ov.alerts_active.critical + ov.alerts_active.warning + ov.alerts_active.info}</div>
              <div className="sev-row">
                {["critical", "warning", "info"].map((s) => (
                  <span key={s} title={s}>
                    <SeverityIcon severity={s} size={13} />
                    <b className="num">{ov.alerts_active[s]}</b>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Needs attention</h2>
              <Link to="/alerts" className="sub">All alerts</Link>
            </div>
            {attention.length ? (
              <ul className="attention">
                {attention.map((a) => (
                  <li key={`${a.host}-${a.message}`}>
                    <Link to={`/hosts/${a.host}`}>
                      <SeverityIcon severity={a.severity} />
                      <div className="grow">
                        <div className="msg"><strong>{a.host}</strong> · {a.message}</div>
                        <div className="meta">{ago(a.when)}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">
                <Bear size={46} mood="sleepy" />
                Nothing needs you right now.
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2><Activity size={14} style={{ verticalAlign: -2 }} /> Collection cycles</h2>
            </div>
            <div className="tiers">
              {Object.entries(ov.tiers).map(([name, tier]) => {
                const f = freshness(tier);
                return (
                  <div className="t" key={name}>
                    <span>{TIER_LABEL[name]} <span className="muted">/{every(tier.every_seconds)}</span></span>
                    <div className="meter"><span className={`tone-${f.tone}`} style={{ width: `${f.pct}%`, background: "var(--tone)" }} /></div>
                    <span className="muted num">{ago(tier.last_run)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
