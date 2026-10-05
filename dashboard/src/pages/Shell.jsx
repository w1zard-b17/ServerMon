import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock, TerminalSquare, X } from "lucide-react";
import Terminal from "../components/Terminal";
import Bear from "../components/Bear";
import { StateDot } from "../components/Status";
import { useFleet } from "../lib/context";

let nextId = 1;

export default function Shell() {
  const { name } = useParams();
  const navigate = useNavigate();
  const { fleet } = useFleet();
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);

  const open = (host) => {
    const id = nextId++;
    setTabs((t) => [...t, { id, host }]);
    setActive(id);
  };

  // /shell/:name opens a session straight away
  const handled = useRef(null);
  useEffect(() => {
    if (name && handled.current !== name) {
      handled.current = name;
      open(name);
      navigate("/shell", { replace: true });
    }
  }, [name]);

  const close = (id) => {
    setTabs((t) => {
      const rest = t.filter((x) => x.id !== id);
      if (active === id) setActive(rest[rest.length - 1]?.id ?? null);
      return rest;
    });
  };

  const hosts = fleet?.hosts || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shell</h1>
          <p>Interactive SSH sessions in the browser, as each host's admin user. Every session asks for a fresh authenticator code and is logged.</p>
        </div>
      </div>
      <div className="term-shell">
        <div className="card term-hosts">
          <div className="section-title" style={{ padding: "8px 10px 2px" }}>Hosts</div>
          {hosts.map((h) => (
            <button
              key={h.name}
              onClick={() => open(h.name)}
              disabled={!h.control || h.reach === "offline"}
              title={!h.control ? "No admin identity configured" : h.reach === "offline" ? "Host is offline" : `Open a shell on ${h.name}`}
            >
              <StateDot state={h.state} />
              <span className="grow">
                <strong>{h.name}</strong>
                <div className="muted mono" style={{ fontSize: 11.5 }}>{h.ip}</div>
              </span>
              {!h.control ? <Lock size={13} className="muted" /> : <TerminalSquare size={14} className="muted" />}
            </button>
          ))}
        </div>

        <div className="card term-panel">
          {tabs.length > 0 ? (
            <>
              <div className="term-tabs" role="tablist">
                {tabs.map((t) => (
                  <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? "on" : ""} onClick={() => setActive(t.id)}>
                    <TerminalSquare size={13} />
                    {t.host}
                    <span
                      role="button"
                      aria-label={`Close ${t.host}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        close(t.id);
                      }}
                      style={{ display: "inline-flex", opacity: 0.7 }}
                    >
                      <X size={13} />
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {tabs.map((t) => (
                  <Terminal key={t.id} host={t.host} active={active === t.id} />
                ))}
              </div>
            </>
          ) : (
            <div className="empty" style={{ flex: 1, color: "#8c9a93" }}>
              <Bear size={56} />
              Pick a host on the left to open a session.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
