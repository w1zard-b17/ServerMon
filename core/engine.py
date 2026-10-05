# engine.py - runs one collection cycle: collect, store, evaluate alerts

from typing import Dict, Any, List
from core import host_manager
from storage import repository
from alerting import rules


def run_cycle(tier: str, host_names: List[str] = None) -> Dict[str, Any]:
    '''host_names limits the cycle to specific hosts (used by the dashboard scan button)'''
    host_reports = host_manager.collect_all(tier, host_names)

    errors = {}
    for report in host_reports:
        host_name = report["host"]

        host_entry = next((h for h in host_manager.get_hosts() if h["name"] == host_name), None)
        if host_entry:
            repository.upsert_host(host_name, host_entry["ip"], host_entry.get("role"))

        if not report["connected"]:
            errors[host_name] = report["error"]
            repository.store_event(host_name, "connection_failed", report["error"])
            continue

        for collector_name, result in report["results"].items():
            repository.store_metric(
                host_name=host_name,
                tier=tier,
                collector=collector_name,
                status=result["status"],
                data=result["data"],
                message=result["message"],
            )

    alerts = rules.evaluate(host_reports)
    for alert in alerts:
        repository.store_event(alert["host"], f"alert_{alert['severity']}", f"[{alert['category']}] {alert['message']}")
        print(f"ALERT [{alert['severity']}] {alert['host']}: {alert['message']}")

    return {
        "tier": tier,
        "hosts_checked": len(host_reports),
        "errors": errors,
        "alerts_fired": len(alerts),
        "host_reports": host_reports,
    }