import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { Minus, Plus, Maximize2, Server, Tag, CircleAlert, CheckCircle2 } from "lucide-react";
import { SeverityPill, StatePill } from "../components/Status";
import Bear from "../components/Bear";
import { useApi } from "../lib/context";
import { ago, dateTime } from "../lib/format";

const RANGES = [
  [24, "24h"],
  [168, "7d"],
  [720, "30d"],
];

const STATE_VAR = { ok: "var(--ok)", warning: "var(--warning)", critical: "var(--critical)", offline: "var(--offline)", stale: "var(--offline)", unknown: "var(--offline)" };
const SEV_VAR = { critical: "var(--critical)", warning: "var(--warning)", info: "var(--info)" };

function radius(n) {
  if (n.kind === "host") return 22;
  if (n.kind === "category") return 13;
  return 5 + Math.min(9, Math.log2(n.count + 1) * 1.4);
}

function useSimulation(graph) {
  const [, setFrame] = useState(0);
  const simRef = useRef(null);
  const model = useMemo(() => {
    if (!graph) return null;
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const hosts = nodes.filter((n) => n.kind === "host");
    // place hosts on a ring so the layout stays stable between reloads
    hosts.forEach((h, i) => {
      const a = (i / hosts.length) * Math.PI * 2;
      h.x = Math.cos(a) * 220;
      h.y = Math.sin(a) * 180;
    });
    nodes.forEach((n) => {
      if (n.x == null) {
        n.x = (Math.random() - 0.5) * 200;
        n.y = (Math.random() - 0.5) * 200;
      }
    });
    const links = graph.links.map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) })).filter((l) => l.source && l.target);
    return { nodes, links, byId };
  }, [graph]);

  useEffect(() => {
    if (!model) return;
    const sim = forceSimulation(model.nodes)
      .force(
        "link",
        forceLink(model.links)
          .distance((l) => ({ host: 70, category: 120, similar: 90, cooccur: 60 })[l.kind] || 80)
          .strength((l) => ({ host: 0.7, category: 0.12, similar: 0.35, cooccur: 0.3 })[l.kind] || 0.2),
      )
      .force("charge", forceManyBody().strength((n) => (n.kind === "host" ? -520 : n.kind === "category" ? -260 : -70)))
      .force("collide", forceCollide().radius((n) => radius(n) + 6))
      .force("x", forceX(0).strength(0.04))
      .force("y", forceY(0).strength(0.05))
      .on("tick", () => setFrame((f) => f + 1));
    simRef.current = sim;
    return () => sim.stop();
  }, [model]);

  return { model, sim: simRef };
}

export default function Graph() {
  const [hours, setHours] = useState(168);
  const { data } = useApi(`/api/alerts/graph?hours=${hours}`);
  const svgRef = useRef(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const [selected, setSelected] = useState(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const zoomRef = useRef(null);
  const { model, sim } = useSimulation(data);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(svg);
    const z = d3zoom()
      .scaleExtent([0.3, 4])
      .filter((ev) => !ev.target.closest?.(".g-node") && (!ev.button || ev.type === "wheel"))
      .on("zoom", (ev) => setTransform(ev.transform));
    select(svg).call(z);
    zoomRef.current = z;
    return () => ro.disconnect();
  }, []);

  const zoomBy = (k) => select(svgRef.current).call(zoomRef.current.scaleBy, k);
  const resetZoom = () => select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);

  // pin a node while it is dragged
  const startDrag = (e, node) => {
    e.stopPropagation();
    const svg = svgRef.current;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // pointer already released, dragging works without capture
    }
    const rect = svg.getBoundingClientRect();
    const toWorld = (ev) => transform.invert([ev.clientX - rect.left - size.w / 2, ev.clientY - rect.top - size.h / 2]);
    let moved = false;
    const move = (ev) => {
      moved = true;
      const [x, y] = toWorld(ev);
      node.fx = x;
      node.fy = y;
      sim.current?.alphaTarget(0.25).restart();
    };
    const up = () => {
      node.fx = node.fy = null;
      sim.current?.alphaTarget(0);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      if (!moved) setSelected((s) => (s === node.id ? null : node.id));
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
  };

  const neighbours = useMemo(() => {
    if (!model || !selected) return null;
    const set = new Set([selected]);
    model.links.forEach((l) => {
      if (l.source.id === selected) set.add(l.target.id);
      if (l.target.id === selected) set.add(l.source.id);
    });
    return set;
  }, [model, selected]);

  const sel = selected && model?.byId.get(selected);
  const related = sel && model ? model.links.filter((l) => (l.source.id === sel.id || l.target.id === sel.id) && (l.kind === "similar" || l.kind === "cooccur")).map((l) => ({ kind: l.kind, node: l.source.id === sel.id ? l.target : l.source })) : [];
  const alertCount = model ? model.nodes.filter((n) => n.kind === "alert").length : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alert graph</h1>
          <p>Hosts and categories are hubs; each small node is one alert group. Links show the same problem on several hosts, or problems that started together.</p>
        </div>
        <div className="segmented">
          {RANGES.map(([h, l]) => (
            <button key={h} className={hours === h ? "on" : ""} onClick={() => { setHours(h); setSelected(null); }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="graph-layout">
        <section className="card graph-stage">
          <svg ref={svgRef} role="img" aria-label="Alert similarity graph">
            <defs>
              <pattern id="g-dots" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
                <circle cx="1" cy="1" r="1" className="g-grid" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#g-dots)" />
            <g transform={`translate(${size.w / 2 + transform.x},${size.h / 2 + transform.y}) scale(${transform.k})`}>
              {model?.links.map((l, i) => (
                <line
                  key={i}
                  className={`g-link ${l.kind} ${neighbours && !(neighbours.has(l.source.id) && neighbours.has(l.target.id)) ? "dim" : ""}`}
                  x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
                  strokeWidth={l.kind === "similar" ? 1.6 : 1}
                />
              ))}
              {model?.nodes.map((n) => {
                const r = radius(n);
                const dim = neighbours && !neighbours.has(n.id);
                const isSel = n.id === selected;
                return (
                  <g key={n.id} className={`g-node ${dim ? "dim" : ""}`} transform={`translate(${n.x},${n.y})`} onPointerDown={(e) => startDrag(e, n)}>
                    {n.kind === "host" && (
                      <>
                        <circle r={r + 8} fill={STATE_VAR[n.state]} opacity={0.12} />
                        <circle r={r} fill="var(--surface-3)" stroke={STATE_VAR[n.state]} strokeWidth={2.5} />
                        <circle r={4} fill={STATE_VAR[n.state]} />
                      </>
                    )}
                    {n.kind === "category" && <circle r={r} fill="var(--surface-3)" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="3 2" />}
                    {n.kind === "alert" && (
                      <>
                        {n.active && <circle r={r + 5} fill={SEV_VAR[n.severity]} opacity={0.18} />}
                        <circle r={r} fill={SEV_VAR[n.severity]} stroke="var(--surface)" strokeWidth={2} opacity={n.active ? 1 : 0.55} />
                      </>
                    )}
                    {isSel && <circle r={r + 4} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
                    {n.kind !== "alert" && (
                      <text className="g-label hub" y={r + 16} textAnchor="middle">{n.label}</text>
                    )}
                    {n.kind === "alert" && (isSel || (neighbours?.has(n.id) && transform.k > 0.8) || transform.k > 1.6) && (
                      <text className="g-label" x={r + 5} y={4}>{n.label.length > 34 ? n.label.slice(0, 33) + "..." : n.label}</text>
                    )}
                    <title>{n.kind === "alert" ? `${n.host}: ${n.label} (${n.count}x)` : n.label}</title>
                  </g>
                );
              })}
            </g>
          </svg>

          {model && !alertCount && (
            <div className="empty" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <Bear size={52} mood="sleepy" />
              No alerts in this range.
            </div>
          )}

          <div className="graph-tools">
            <button className="btn btn-icon" onClick={() => zoomBy(1.3)} aria-label="Zoom in"><Plus size={16} /></button>
            <button className="btn btn-icon" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out"><Minus size={16} /></button>
            <button className="btn btn-icon" onClick={resetZoom} aria-label="Reset view"><Maximize2 size={15} /></button>
          </div>
          <div className="graph-legend">
            <span><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="var(--surface-3)" stroke="var(--ok)" strokeWidth="2" /></svg>Host</span>
            <span><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="var(--surface-3)" stroke="var(--muted)" strokeDasharray="3 2" strokeWidth="1.5" /></svg>Category</span>
            {["critical", "warning", "info"].map((s) => (
              <span key={s}><svg width="10" height="10"><circle cx="5" cy="5" r="4.5" fill={SEV_VAR[s]} /></svg>{s}</span>
            ))}
            <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" className="g-link similar" strokeWidth="1.6" /></svg>same problem, other host</span>
            <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" className="g-link cooccur" strokeWidth="1.6" /></svg>started together</span>
          </div>
        </section>

        <aside className="card card-pad" style={{ alignSelf: "start" }}>
          {!sel ? (
            <div className="stack" style={{ gap: 10 }}>
              <h2>Details</h2>
              <p className="muted" style={{ margin: 0 }}>Click a node to see what it is connected to. Drag nodes to untangle, scroll to zoom.</p>
              {model && (
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>Alert groups</dt><dd>{alertCount}</dd>
                  <dt>Similar links</dt><dd>{model.links.filter((l) => l.kind === "similar").length}</dd>
                  <dt>Co-occurring links</dt><dd>{model.links.filter((l) => l.kind === "cooccur").length}</dd>
                </dl>
              )}
            </div>
          ) : sel.kind === "alert" ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row wrap">
                <SeverityPill severity={sel.severity} />
                {sel.active ? <span className={`pill tone-${sel.severity}`}><CircleAlert size={12} /> active</span> : <span className="pill tone-ok"><CheckCircle2 size={12} /> cleared</span>}
              </div>
              <h2>{sel.message}</h2>
              <dl className="kv">
                <dt>Host</dt><dd><Link to={`/hosts/${sel.host}`} style={{ fontWeight: 600 }}>{sel.host}</Link></dd>
                <dt>Category</dt><dd>{sel.category}</dd>
                <dt>Occurrences</dt><dd>{sel.count}</dd>
                <dt>First seen</dt><dd>{dateTime(sel.first_seen)}</dd>
                <dt>Last seen</dt><dd>{ago(sel.last_seen)}</dd>
              </dl>
              {related.length > 0 && (
                <div>
                  <div className="section-title" style={{ marginTop: 6 }}>Connected alerts</div>
                  <div className="stack" style={{ gap: 6 }}>
                    {related.map(({ kind, node }) => (
                      <button key={node.id} className="btn btn-sm" style={{ justifyContent: "flex-start", height: "auto", padding: "6px 10px", whiteSpace: "normal", textAlign: "left" }} onClick={() => setSelected(node.id)}>
                        <span className={`dot tone-${node.severity}`} />
                        <span className="grow"><b>{node.host}</b> · {node.message}<br /><span className="muted" style={{ fontSize: 11.5 }}>{kind === "similar" ? "same problem" : "started together"}</span></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row">
                {sel.kind === "host" ? <Server size={18} /> : <Tag size={18} />}
                <h2>{sel.label}</h2>
                {sel.kind === "host" && <StatePill state={sel.state} />}
              </div>
              <div className="muted">{sel.count} alert occurrence{sel.count === 1 ? "" : "s"} in range</div>
              <div className="stack" style={{ gap: 6 }}>
                {model.links
                  .filter((l) => l.target.id === sel.id && l.source.kind === "alert")
                  .map((l) => l.source)
                  .map((a) => (
                    <button key={a.id} className="btn btn-sm" style={{ justifyContent: "flex-start", height: "auto", padding: "6px 10px", whiteSpace: "normal", textAlign: "left" }} onClick={() => setSelected(a.id)}>
                      <span className={`dot tone-${a.severity}`} />
                      <span className="grow">{sel.kind === "category" && <b>{a.host} · </b>}{a.message} <span className="muted">x{a.count}</span></span>
                    </button>
                  ))}
              </div>
              {sel.kind === "host" && <Link className="btn" to={`/hosts/${sel.label}`}>Open host</Link>}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
