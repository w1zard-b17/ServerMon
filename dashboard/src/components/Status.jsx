// every status shows an icon and a word, not only a color

import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, PowerOff, Clock } from "lucide-react";
import { SEVERITY_LABEL, STATE_LABEL } from "../lib/format";

const STATE_ICON = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertOctagon,
  offline: PowerOff,
  stale: Clock,
  unknown: CircleDashed,
};

const SEVERITY_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info };

export function StatePill({ state }) {
  const Icon = STATE_ICON[state] || CircleDashed;
  return (
    <span className={`pill tone-${state}`}>
      <Icon size={12} strokeWidth={2.4} />
      {STATE_LABEL[state] || state}
    </span>
  );
}

export function SeverityPill({ severity }) {
  const Icon = SEVERITY_ICON[severity] || Info;
  return (
    <span className={`pill tone-${severity}`}>
      <Icon size={12} strokeWidth={2.4} />
      {SEVERITY_LABEL[severity] || severity}
    </span>
  );
}

export function SeverityIcon({ severity, size = 15 }) {
  const Icon = SEVERITY_ICON[severity] || Info;
  return (
    <span className={`tone-${severity}`} style={{ color: "var(--tone)", display: "inline-flex" }}>
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}

export function StateDot({ state, glow }) {
  return <span className={`dot tone-${state} ${glow ? "glow" : ""}`} aria-hidden="true" />;
}

export function Meter({ value, tone }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="meter" role="presentation">
      <span className={tone ? `tone-${tone}` : ""} style={{ width: `${pct}%`, background: tone ? "var(--tone)" : undefined }} />
    </div>
  );
}
