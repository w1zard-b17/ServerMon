# status.py - derives dashboard state from the raw metrics and events tables
#
# the engine only writes a log, so current state is worked out here:
#   online        newest metric row is newer than the newest connection failure and not stale
#   active alert  raised by the latest run of the tier that checks its category
#   alert group   repeats of the same host, category and message (numbers masked) merged with a count

import hashlib
import re
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

from config.settings import load_inventory
from config.constants import (
    TIMING_BY_TIERS, ALERT_CATEGORY_TIER,
    DISK_USAGE_WARNING, DISK_USAGE_CRITICAL, MEMORY_USAGE_WARNING, CPU_TEMP_WARNING, DISK_TEMP_WARNING,
)
from storage import repository

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
_DESC = re.compile(r"^\[(?P<category>[^\]]+)\]\s*(?P<message>.*)$", re.S)
_NUMBER = re.compile(r"(?<![A-Za-z_])\d+(?:\.\d+)?")   # masks values, keeps device names like cpu0
COOCCUR_SECONDS = 600   # alerts on one host first seen this close together are linked


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(ts: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(ts) if ts else None


# --- ALERT PARSING ---

def parse_alert(event: Dict[str, Any]) -> Dict[str, Any]:
    '''turns an alert event row into a structured alert'''
    match = _DESC.match(event.get("description") or "")
    category = match["category"] if match else "other"
    message = match["message"] if match else (event.get("description") or "")
    return {
        "id": event["id"],
        "host": event["host_name"],
        "severity": event["event_type"].removeprefix("alert_"),
        "category": category,
        "message": message,
        "signature": _NUMBER.sub("#", message),
        "recorded_at": event["recorded_at"],
    }


def _group_id(host: str, category: str, signature: str) -> str:
    return hashlib.sha1(f"{host}|{category}|{signature}".encode()).hexdigest()[:12]


# --- HOST STATE ---

class Snapshot:
    '''one read of everything needed to describe the current state'''

    def __init__(self):
        self.inventory = load_inventory()
        self.host_rows = repository.get_host_rows()
        self.runs = repository.get_last_run_times()
        self.fails = repository.get_last_event_times("connection_failed")

        self.latest: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
        for row in repository.get_latest_metrics_all():
            self.latest[row["host_name"]][row["collector"]] = row

        # alerts older than the oldest latest run cannot be active
        candidates = [t for tiers in self.runs.values() for t in tiers.values()] + list(self.fails.values())
        since = min(candidates) if candidates else None
        self.recent_alerts = [parse_alert(e) for e in repository.get_events(since=since, type_prefix="alert_")] if since else []

        self.hosts = {h["name"]: self._host_state(h) for h in self.inventory}

    def _host_state(self, host: Dict[str, Any]) -> Dict[str, Any]:
        name = host["name"]
        runs = self.runs.get(name, {})
        last_ok = max(runs.values()) if runs else None
        last_fail = self.fails.get(name)
        cadence = min(TIMING_BY_TIERS[t] for t in host["tiers"]) if host["tiers"] else TIMING_BY_TIERS["fast"]
        stale_after = timedelta(seconds=cadence * 2 + 120)

        if not last_ok and not last_fail:
            reach = "unknown"
        elif last_fail and (not last_ok or last_fail > last_ok):
            reach = "offline"
        elif _now() - _parse(last_ok) > stale_after:
            reach = "stale"
        else:
            reach = "online"

        active = [a for a in self.recent_alerts if a["host"] == name and self._is_active(a, reach, runs, last_fail)]

        if reach != "online":
            state = reach
        elif any(a["severity"] == "critical" for a in active):
            state = "critical"
        elif any(a["severity"] == "warning" for a in active):
            state = "warning"
        else:
            state = "ok"

        return {
            "reach": reach,
            "state": state,
            "last_ok": last_ok,
            "last_fail": last_fail,
            "last_runs": runs,
            "active_alerts": active,
        }

    @staticmethod
    def _is_active(alert: Dict[str, Any], reach: str, runs: Dict[str, str], last_fail: Optional[str]) -> bool:
        if alert["category"] == "connection":
            return reach == "offline" and last_fail is not None and alert["recorded_at"] >= last_fail
        if reach == "offline":
            return False   # unreachable host: other findings are not current
        tier = ALERT_CATEGORY_TIER.get(alert["category"])
        run = runs.get(tier) if tier else None
        return run is not None and alert["recorded_at"] >= run

    def is_active(self, alert: Dict[str, Any]) -> bool:
        state = self.hosts.get(alert["host"])
        if state is None:
            return False
        return any(a["id"] == alert["id"] for a in state["active_alerts"])


# --- HOST SUMMARIES ---

def _data(latest: Dict[str, Dict[str, Any]], collector: str) -> Optional[Dict[str, Any]]:
    row = latest.get(collector)
    return row["data"] if row and row["status"] == "ok" else None


def host_summary(snapshot: Snapshot, host: Dict[str, Any]) -> Dict[str, Any]:
    '''compact host view used by the cards, the 3D stack and the host list'''
    from control.service_control import control_available

    name = host["name"]
    state = snapshot.hosts[name]
    latest = snapshot.latest.get(name, {})

    sysm = _data(latest, "system_metrics.check") or {}
    temp = _data(latest, "temperature.check") or {}
    svc = _data(latest, "services.check") or {}
    fw = _data(latest, "firewall.check") or {}
    pkg = _data(latest, "packages.check") or {}

    disks = sysm.get("disk_usage") or []
    fullest = max(disks, key=lambda d: d.get("capacity_percent") or 0) if disks else None
    cpu_temps = [s["value"] for s in temp.get("cpu", [])]
    disk_temps = [s["value"] for s in temp.get("disk", [])]

    counts = {"critical": 0, "warning": 0, "info": 0}
    for alert in state["active_alerts"]:
        counts[alert["severity"]] = counts.get(alert["severity"], 0) + 1

    return {
        "name": name,
        "ip": host["ip"],
        "role": host.get("role"),
        "tiers": host["tiers"],
        "state": state["state"],
        "reach": state["reach"],
        "last_ok": state["last_ok"],
        "last_fail": state["last_fail"],
        "last_runs": state["last_runs"],
        "first_seen": (snapshot.host_rows.get(name) or {}).get("first_seen"),
        "control": control_available(name),
        "alerts": counts,
        "metrics": {
            "load1": (sysm.get("cpu_load") or {}).get("load1"),
            "load5": (sysm.get("cpu_load") or {}).get("load5"),
            "load15": (sysm.get("cpu_load") or {}).get("load15"),
            "memory_percent": (sysm.get("memory") or {}).get("used_percent"),
            "swap_percent": (sysm.get("memory") or {}).get("swap_used_percent"),
            "disk_max": {"mount": fullest["mounted_on"], "percent": fullest["capacity_percent"]} if fullest else None,
            "boot_time": (sysm.get("uptime") or {}).get("boot_time"),
            "cpu_temp": max(cpu_temps) if cpu_temps else None,
            "disk_temp": max(disk_temps) if disk_temps else None,
            "pf_enabled": fw.get("pf_enabled"),
            "pf_rules": fw.get("rule_count"),
            "pf_states": (fw.get("state_table") or {}).get("current_entries"),
            "services_enabled": len(svc.get("enabled_services") or []) if svc else None,
            "services_failed": svc.get("failed_services") if svc else None,
            "patches_pending": (pkg.get("pending_patches") or {}).get("count"),
            "packages_outdated": (pkg.get("outdated_packages") or {}).get("count"),
            "mirror_unreachable": (pkg.get("outdated_packages") or {}).get("mirror_unreachable"),
            "os_release": (pkg.get("os_version") or {}).get("release"),
        },
        "collectors": {
            collector: {"status": row["status"], "message": row["message"], "recorded_at": row["recorded_at"], "tier": row["tier"]}
            for collector, row in latest.items()
        },
    }


def host_detail(snapshot: Snapshot, host: Dict[str, Any]) -> Dict[str, Any]:
    name = host["name"]
    latest = snapshot.latest.get(name, {})
    since = _iso(_now() - timedelta(days=7))
    return {
        **host_summary(snapshot, host),
        "expected_services": host.get("expected_services", []),
        "admin_user": host.get("admin_user"),
        "data": {collector: row["data"] for collector, row in latest.items() if row["status"] == "ok"},
        "alert_groups": group_alerts(snapshot, since=since, host=name),
        "timeline": [
            _timeline_item(e)
            for e in repository.get_events(since=since, host_name=name, limit=200)
        ],
    }


def _timeline_item(event: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": event["id"],
        "type": event["event_type"],
        "description": event["description"],
        "recorded_at": event["recorded_at"],
    }


# --- OVERVIEW ---

def overview(snapshot: Snapshot) -> Dict[str, Any]:
    states = snapshot.hosts.values()
    active = [a for s in states for a in s["active_alerts"]]
    tier_runs = {}
    for tier, seconds in TIMING_BY_TIERS.items():
        times = [r[tier] for r in snapshot.runs.values() if tier in r]
        tier_runs[tier] = {"last_run": max(times) if times else None, "every_seconds": seconds}

    return {
        "generated_at": _iso(_now()),
        "hosts_expected": len(snapshot.inventory),
        "hosts_online": sum(1 for s in states if s["reach"] == "online"),
        "hosts_by_state": {k: sum(1 for s in states if s["state"] == k) for k in ("ok", "warning", "critical", "offline", "stale", "unknown")},
        "alerts_active": {sev: sum(1 for a in active if a["severity"] == sev) for sev in ("critical", "warning", "info")},
        "tiers": tier_runs,
        "thresholds": {
            "disk_warning": DISK_USAGE_WARNING,
            "disk_critical": DISK_USAGE_CRITICAL,
            "memory_warning": MEMORY_USAGE_WARNING,
            "cpu_temp_warning": CPU_TEMP_WARNING,
            "disk_temp_warning": DISK_TEMP_WARNING,
        },
    }


# --- ALERT GROUPS & GRAPH ---

def group_alerts(snapshot: Snapshot, since: str, host: str = None) -> List[Dict[str, Any]]:
    events = repository.get_events(since=since, host_name=host, type_prefix="alert_", limit=20000)
    groups: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for alert in map(parse_alert, events):   # newest first
        key = (alert["host"], alert["category"], alert["signature"])
        group = groups.get(key)
        if group is None:
            groups[key] = {
                "id": _group_id(*key),
                "host": alert["host"],
                "category": alert["category"],
                "signature": alert["signature"],
                "severity": alert["severity"],
                "max_severity": alert["severity"],
                "message": alert["message"],
                "count": 1,
                "first_seen": alert["recorded_at"],
                "last_seen": alert["recorded_at"],
                "active": snapshot.is_active(alert),
            }
            continue
        group["count"] += 1
        group["first_seen"] = alert["recorded_at"]
        if SEVERITY_RANK.get(alert["severity"], 0) > SEVERITY_RANK.get(group["max_severity"], 0):
            group["max_severity"] = alert["severity"]

    # active first, then most severe, then most recent
    ordered = sorted(groups.values(), key=lambda g: g["last_seen"], reverse=True)
    return sorted(ordered, key=lambda g: (not g["active"], -SEVERITY_RANK.get(g["severity"], 0)))


def alert_graph(snapshot: Snapshot, since: str) -> Dict[str, Any]:
    '''
    nodes are hosts, categories and alert groups. links:
      host, category  each group to its host and category
      similar         same problem on different hosts
      cooccur         different problems on one host that started together
    '''
    groups = group_alerts(snapshot, since=since)
    nodes, links = [], []

    hosts = sorted({g["host"] for g in groups} | {h["name"] for h in snapshot.inventory})
    categories = sorted({g["category"] for g in groups})

    for name in hosts:
        state = snapshot.hosts.get(name, {}).get("state", "unknown")
        nodes.append({"id": f"host:{name}", "kind": "host", "label": name, "state": state,
                      "count": sum(g["count"] for g in groups if g["host"] == name)})
    for cat in categories:
        nodes.append({"id": f"cat:{cat}", "kind": "category", "label": cat,
                      "count": sum(g["count"] for g in groups if g["category"] == cat)})
    for g in groups:
        nodes.append({**g, "id": f"grp:{g['id']}", "group_id": g["id"], "kind": "alert", "label": g["message"]})
        links.append({"source": f"grp:{g['id']}", "target": f"host:{g['host']}", "kind": "host"})
        links.append({"source": f"grp:{g['id']}", "target": f"cat:{g['category']}", "kind": "category"})

    for i, a in enumerate(groups):
        for b in groups[i + 1:]:
            if a["host"] != b["host"] and a["category"] == b["category"] and a["signature"] == b["signature"]:
                links.append({"source": f"grp:{a['id']}", "target": f"grp:{b['id']}", "kind": "similar"})
            elif a["host"] == b["host"] and a["category"] != b["category"]:
                gap = abs((_parse(a["first_seen"]) - _parse(b["first_seen"])).total_seconds())
                if gap <= COOCCUR_SECONDS:
                    links.append({"source": f"grp:{a['id']}", "target": f"grp:{b['id']}", "kind": "cooccur"})

    return {"nodes": nodes, "links": links, "since": since}


# --- TRENDS ---

def trends(host_name: str, hours: int) -> Dict[str, Any]:
    since = _iso(_now() - timedelta(hours=hours))
    system = [
        {
            "t": row["recorded_at"],
            "load1": (row["data"].get("cpu_load") or {}).get("load1"),
            "memory": (row["data"].get("memory") or {}).get("used_percent"),
            "swap": (row["data"].get("memory") or {}).get("swap_used_percent"),
            "disks": {d["mounted_on"]: d["capacity_percent"] for d in row["data"].get("disk_usage") or []},
        }
        for row in repository.get_metric_history(host_name, "system_metrics.check", since)
    ]
    temperature = [
        {
            "t": row["recorded_at"],
            "sensors": {s["device"]: s["value"] for cat in ("cpu", "disk", "other") for s in row["data"].get(cat) or []},
        }
        for row in repository.get_metric_history(host_name, "temperature.check", since)
    ]
    return {"since": since, "system": system, "temperature": temperature}
