// SVG line chart with a dashed threshold line and a hover tooltip

import { useMemo, useRef, useState, useLayoutEffect } from "react";

const PAD = { top: 12, right: 12, bottom: 22, left: 34 };
const HEIGHT = 170;

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function timeLabel(t, spanHours) {
  const d = new Date(t);
  return spanHours > 36
    ? d.toLocaleDateString(undefined, { weekday: "short", hour: "2-digit" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// series: [{ key, label, points: [{ t, v }] }], threshold: { value, label }
export default function TrendChart({ series, threshold, yMax, unit = "", digits = 0 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const all = series.flatMap((s) => s.points);
  const t0 = all.length ? Math.min(...all.map((p) => p.t)) : 0;
  const t1 = all.length ? Math.max(...all.map((p) => p.t)) : 1;
  const vmax = yMax ?? niceMax(Math.max(threshold?.value ?? 0, ...all.map((p) => p.v ?? 0)) * 1.1);
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = (t) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * innerW;
  const y = (v) => PAD.top + innerH - (v / vmax) * innerH;

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        let pen = false;
        for (const p of s.points) {
          if (p.v == null) {
            pen = false;
            continue;
          }
          d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
          pen = true;
        }
        return d;
      }),
    [series, width, vmax, t0, t1],
  );

  const ticks = [0, 0.5, 1].map((f) => f * vmax);
  const spanHours = (t1 - t0) / 3.6e6;
  const xticks = width > 0 ? [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0)) : [];

  const onMove = (e) => {
    if (!all.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = t0 + ((px - PAD.left) / innerW) * (t1 - t0);
    const ref0 = series[0]?.points || [];
    if (!ref0.length) return;
    let best = ref0[0];
    for (const p of ref0) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const values = series.map((s) => {
      const p = s.points.reduce((a, b) => (Math.abs(b.t - best.t) < Math.abs(a.t - best.t) ? b : a), s.points[0]);
      return { label: s.label, v: p?.v, i: series.indexOf(s) };
    });
    setHover({ t: best.t, values });
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {!all.length && <div className="empty" style={{ height: HEIGHT }}>No history in this range</div>}
      {all.length > 0 && width > 0 && <svg width={width} height={HEIGHT} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)" className="num">
              {Number(v.toFixed(2))}
            </text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={i} x={x(t)} y={HEIGHT - 5} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} fontSize="10.5" fill="var(--muted)">
            {timeLabel(t, spanHours)}
          </text>
        ))}
        {threshold && threshold.value <= vmax && (
          <g>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(threshold.value)} y2={y(threshold.value)} stroke="var(--warning)" strokeDasharray="4 4" strokeWidth={1} />
            <text x={PAD.left + innerW} y={y(threshold.value) - 5} textAnchor="end" fontSize="10.5" fill="var(--text-2)">
              {threshold.label}
            </text>
          </g>
        )}
        {paths.map((d, i) => (
          <path key={series[i].key} d={d} fill="none" stroke={`var(--series-${(i % 5) + 1})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover && (
          <g>
            <line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--axis)" strokeWidth={1} />
            {hover.values.map((h) =>
              h.v == null ? null : (
                <circle key={h.label} cx={x(hover.t)} cy={y(h.v)} r={4} fill={`var(--series-${(h.i % 5) + 1})`} stroke="var(--surface)" strokeWidth={2} />
              ),
            )}
          </g>
        )}
      </svg>}
      {all.length > 0 && !width && <div style={{ height: HEIGHT }} />}
      {hover && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover.t), 70), width - 70), top: PAD.top + 4 }}>
          <div className="t">{new Date(hover.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          {hover.values.map((h) => (
            <div key={h.label} className="row" style={{ gap: 6 }}>
              <i style={{ width: 8, height: 2, background: `var(--series-${(h.i % 5) + 1})`, display: "inline-block" }} />
              <span className="text-2">{h.label}</span>
              <strong className="num" style={{ marginLeft: "auto" }}>{h.v == null ? "-" : `${h.v.toFixed(digits)}${unit}`}</strong>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s, i) => (
            <span key={s.key} style={{ "--c": `var(--series-${(i % 5) + 1})` }}>
              <i />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
