# rules.py - evaluates collector results against thresholds, returns a list of alerts

from typing import List, Dict, Any
from config.constants import (
    DISK_USAGE_WARNING,
    DISK_USAGE_CRITICAL,
    MEMORY_USAGE_WARNING,
    CPU_TEMP_WARNING,
    DISK_TEMP_WARNING,
)


def _alert(host: str, severity: str, category: str, message: str) -> Dict[str, Any]:
    return {"host": host, "severity": severity, "category": category, "message": message}


def evaluate(host_reports: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    '''
    takes the host_reports list as produced by host_manager.collect_all()
    and returns every threshold breach found, across all hosts/collectors present.
    '''
    alerts = []

    for report in host_reports:
        host = report["host"]

        if not report["connected"]:
            alerts.append(_alert(host, "critical", "connection", f"host unreachable: {report['error']}"))
            continue

        results = report["results"]

        if "services.check" in results:
            alerts.extend(_check_services(host, results["services.check"]))
        if "firewall.check" in results:
            alerts.extend(_check_firewall(host, results["firewall.check"]))
        if "system_metrics.check" in results:
            alerts.extend(_check_system_metrics(host, results["system_metrics.check"]))
        if "temperature.check" in results:
            alerts.extend(_check_temperature(host, results["temperature.check"]))
        if "packages.check" in results:
            alerts.extend(_check_packages(host, results["packages.check"]))

    return alerts


def _check_services(host: str, result: Dict[str, Any]) -> List[Dict[str, Any]]:
    if result["status"] != "ok":
        return []
    return [
        _alert(host, "critical", "service", f"service failed: {svc}")
        for svc in result["data"].get("failed_services", [])
    ]


def _check_firewall(host: str, result: Dict[str, Any]) -> List[Dict[str, Any]]:
    if result["status"] != "ok":
        return []
    if not result["data"].get("pf_enabled", True):
        return [_alert(host, "critical", "firewall", "pf is disabled")]
    return []


def _check_system_metrics(host: str, result: Dict[str, Any]) -> List[Dict[str, Any]]:
    if result["status"] != "ok":
        return []

    alerts = []
    data = result["data"]

    used = data.get("memory", {}).get("used_percent")
    if used is not None and used >= MEMORY_USAGE_WARNING:
        alerts.append(_alert(host, "warning", "memory", f"memory usage at {used}%"))

    for disk in data.get("disk_usage", []):
        cap = disk.get("capacity_percent")
        if cap is None:
            continue
        if cap >= DISK_USAGE_CRITICAL:
            alerts.append(_alert(host, "critical", "disk", f"{disk['mounted_on']} at {cap}% capacity"))
        elif cap >= DISK_USAGE_WARNING:
            alerts.append(_alert(host, "warning", "disk", f"{disk['mounted_on']} at {cap}% capacity"))

    return alerts


def _check_temperature(host: str, result: Dict[str, Any]) -> List[Dict[str, Any]]:
    if result["status"] != "ok":
        return []

    alerts = []
    data = result["data"]

    for sensor in data.get("cpu", []):
        if sensor["value"] >= CPU_TEMP_WARNING:
            alerts.append(_alert(host, "warning", "temperature", f"{sensor['device']} at {sensor['value']}{sensor['unit']}"))

    for sensor in data.get("disk", []):
        if sensor["value"] >= DISK_TEMP_WARNING:
            alerts.append(_alert(host, "warning", "temperature", f"{sensor['device']} at {sensor['value']}{sensor['unit']}"))

    return alerts


def _check_packages(host: str, result: Dict[str, Any]) -> List[Dict[str, Any]]:
    if result["status"] != "ok":
        return []

    count = result["data"].get("pending_patches", {}).get("count", 0)
    if count > 0:
        return [_alert(host, "info", "patches", f"{count} pending security patch(es)")]
    return []