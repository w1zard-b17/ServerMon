export const STATE_LABEL = {
  ok: "Healthy",
  warning: "Warning",
  critical: "Critical",
  offline: "Offline",
  stale: "No recent data",
  unknown: "Never scanned",
};

export const SEVERITY_LABEL = { critical: "Critical", warning: "Warning", info: "Info" };

export const COLLECTOR_LABEL = {
  "services.check": "Services",
  "firewall.check": "Firewall",
  "system_metrics.check": "System",
  "temperature.check": "Temperature",
  "packages.check": "Packages",
};

export function isLit(state) {
  return state === "ok" || state === "warning" || state === "critical";
}

export function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function dateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function num(v, digits = 0, suffix = "") {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${Number(v).toFixed(digits)}${suffix}`;
}

export function uptime(bootTime) {
  if (!bootTime) return "-";
  const t = new Date(bootTime).getTime();
  if (Number.isNaN(t)) return bootTime;
  const s = (Date.now() - t) / 1000;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`;
}

export function level(value, warn, crit) {
  if (value === null || value === undefined) return "none";
  if (crit !== undefined && value >= crit) return "critical";
  if (warn !== undefined && value >= warn) return "warning";
  return "ok";
}
