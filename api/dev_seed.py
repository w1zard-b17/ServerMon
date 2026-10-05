# dev_seed.py - fills a scratch database with 3 days of simulated data for dashboard development
#
#     SERVERMON_DB=demo.db SERVERMON_HOSTS_FILE=config/hosts.demo.yaml python -m api.dev_seed
#
# alerts go through the real alerting.rules.evaluate(), so events match what the engine writes.

import json
import math
import os
import random
import sys
from datetime import datetime, timezone, timedelta

from alerting import rules
from config.constants import TIMING_BY_TIERS
from config.settings import load_inventory
from storage.db import DB_PATH, get_connection, init_db

DAYS = 3
random.seed(7)

if "SERVERMON_DB" not in os.environ:
    sys.exit("refusing to seed the real database: set SERVERMON_DB to a scratch file")


def _profile(index: int, name: str):
    '''gives each demo host a different behaviour so every state shows up'''
    return {
        "offline_after": timedelta(hours=5) if index == 2 else None,   # third host goes offline 5h ago
        "hot": index == 3,                                             # fourth runs hot and fills /var
        "failed_service": "httpd" if index == 1 else None,             # second has a failed service
        "base_load": 0.1 + 0.25 * index,
        "has_sensors": index != 1,
    }


def _system(t: datetime, p, i: int):
    wave = (math.sin(t.timestamp() / 5400 + i) + 1) / 2
    mem = 30 + 25 * wave + random.uniform(-3, 3) + (38 if p["hot"] and t.hour % 6 == 0 else 0)
    var = 62 + (t - START).total_seconds() / 3600 * (0.45 if p["hot"] else 0.02)
    return {
        "cpu_load": {k: round(p["base_load"] + wave * f + random.uniform(0, 0.1), 2)
                     for k, f in (("load1", 0.9), ("load5", 0.6), ("load15", 0.4))},
        "memory": {"pages_total": 1998025, "pages_free": int(1998025 * (1 - mem / 100)),
                   "used_percent": round(min(mem, 97), 2), "swap_used_percent": 0.0},
        "disk_usage": [
            {"filesystem": "/dev/sd0a", "size_kb": 1009422, "used_kb": 168340, "avail_kb": 790612, "capacity_percent": 18, "mounted_on": "/"},
            {"filesystem": "/dev/sd0d", "size_kb": 4127406, "used_kb": 12, "avail_kb": 3921026, "capacity_percent": 1, "mounted_on": "/tmp"},
            {"filesystem": "/dev/sd0e", "size_kb": 8233244, "used_kb": 0, "avail_kb": 0, "capacity_percent": int(min(var, 96)), "mounted_on": "/var"},
            {"filesystem": "/dev/sd0f", "size_kb": 6192476, "used_kb": 2180612, "avail_kb": 3702244, "capacity_percent": 37, "mounted_on": "/usr"},
            {"filesystem": "/dev/sd0h", "size_kb": 51605240, "used_kb": 9802410, "avail_kb": 39222568, "capacity_percent": 20, "mounted_on": "/home"},
        ],
        "uptime": {"boot_time": "Tue Sep 22 12:15:57 2026"},
    }


def _temperature(t: datetime, p, i: int):
    if not p["has_sensors"]:
        return {"cpu": [], "disk": [], "other": []}
    wave = (math.sin(t.timestamp() / 7200 + i) + 1) / 2
    cpu = 44 + 10 * wave + (24 if p["hot"] else 0) + random.uniform(-1, 1)
    disk = 40 + 6 * wave + (14 if p["hot"] else 0)
    return {
        "cpu": [{"device": "cpu0", "value": round(cpu, 1), "unit": "degC", "category": "cpu"}],
        "disk": [{"device": "nvme0", "value": round(disk, 1), "unit": "degC", "category": "disk"}],
        "other": [],
    }


def _services(p):
    return {"failed_services": [p["failed_service"]] if p["failed_service"] else [],
            "enabled_services": ["cron", "ntpd", "pflogd", "slaacd", "smtpd", "sndiod", "sshd", "syslogd", "httpd", "unbound"]}


def _firewall():
    return {"pf_enabled": True, "state_table": {"current_entries": random.randint(3, 40)}, "rule_count": 5}


def _packages():
    patches = [f"{n:03d}_{p}" for n, p in enumerate(["xserver", "smtpd", "libssl", "sshd", "unbound", "kernel", "httpd"], 1)]
    return {
        "outdated_packages": {"count": 2, "packages": ["curl-8.9.1->8.10.0", "python-3.12.5->3.12.6"], "mirror_unreachable": False},
        "pending_patches": {"count": len(patches), "patches": patches},
        "installed_packages": ["bzip2-1.0.8p0", "curl-8.9.1", "gettext-runtime-0.22.5", "python-3.12.5", "py3-paramiko-3.4.0", "py3-yaml-6.0.1"],
        "os_version": {"release": "7.9"},
    }


COLLECTORS = {
    "fast": {"services.check": lambda t, p, i: _services(p), "firewall.check": lambda t, p, i: _firewall()},
    "medium": {"system_metrics.check": _system, "temperature.check": _temperature},
    "slow": {"packages.check": lambda t, p, i: _packages()},
}

NOW = datetime.now(timezone.utc)
START = NOW - timedelta(days=DAYS)


def main():
    if DB_PATH.exists():
        DB_PATH.unlink()
    init_db()
    hosts = load_inventory()
    profiles = {h["name"]: _profile(i, h["name"]) for i, h in enumerate(hosts)}

    # every (time, tier) run over the window, in order, as the scheduler would produce them
    firings = []
    for tier, seconds in TIMING_BY_TIERS.items():
        t = START + timedelta(seconds=random.randint(0, 60))
        while t <= NOW:
            firings.append((t, tier))
            t += timedelta(seconds=seconds)
    firings.sort()

    conn = get_connection()
    for h in hosts:
        conn.execute("INSERT INTO hosts (name, ip, role, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
                     (h["name"], h["ip"], h.get("role"), START.isoformat(), NOW.isoformat()))

    for t, tier in firings:
        reports = []
        for i, h in enumerate(hosts):
            p = profiles[h["name"]]
            if tier not in h["tiers"]:
                continue
            if p["offline_after"] and t > NOW - p["offline_after"]:
                reports.append({"host": h["name"], "connected": False, "error": "connection failed: timed out", "results": {}})
                continue
            results = {name: {"status": "ok", "data": fn(t, p, i), "message": None} for name, fn in COLLECTORS[tier].items()}
            reports.append({"host": h["name"], "connected": True, "error": None, "results": results})

        stamp = t
        for r in reports:
            if not r["connected"]:
                conn.execute("INSERT INTO events (host_name, event_type, description, recorded_at) VALUES (?, ?, ?, ?)",
                             (r["host"], "connection_failed", r["error"], stamp.isoformat()))
                continue
            for collector, res in r["results"].items():
                stamp += timedelta(milliseconds=40)
                conn.execute(
                    "INSERT INTO metrics (host_name, tier, collector, status, data, message, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (r["host"], tier, collector, res["status"], json.dumps(res["data"]), res["message"], stamp.isoformat()),
                )
        for alert in rules.evaluate(reports):
            stamp += timedelta(milliseconds=5)
            conn.execute("INSERT INTO events (host_name, event_type, description, recorded_at) VALUES (?, ?, ?, ?)",
                         (alert["host"], f"alert_{alert['severity']}", f"[{alert['category']}] {alert['message']}", stamp.isoformat()))

    conn.commit()
    conn.close()
    print(f"[seed] {len(firings)} cycles for {len(hosts)} hosts written to {DB_PATH}")


if __name__ == "__main__":
    main()
