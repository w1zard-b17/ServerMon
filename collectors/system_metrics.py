# system_metrics.py - cpu load, memory, disk usage, uptime/reboot

from collectors.base import Collector
from connection.ssh_client import run_command
from typing import Dict, Any, List
from config.constants import (
    GET_CPU_LOAD,
    GET_MEMORY,
    GET_SWAP,
    GET_DISK_USAGE,
    GET_UPTIME
)


class SystemMetrics(Collector):
    name = "system_metrics.check"

    def run(self, ssh_client) -> Dict[str, Any]:
        return {
            "cpu_load": self._get_cpu_load(ssh_client),
            "memory": self._get_memory(ssh_client),
            "disk_usage": self._get_disk_usage(ssh_client),
            "uptime": self._get_uptime(ssh_client),
        }

    def _get_cpu_load(self, ssh_client) -> Dict[str, float]:
        output = run_command(ssh_client, GET_CPU_LOAD)
        raw = output.split("=", 1)[1].strip()
        load1, load5, load15 = (float(x) for x in raw.split())
        return {"load1": load1, "load5": load5, "load15": load15}

    def _get_memory(self, ssh_client) -> Dict[str, Any]:
        output = run_command(ssh_client, GET_MEMORY)
        pages_total = pages_free = None

        for line in output.splitlines():
            parts = line.strip().split()
            if len(parts) < 2:
                continue
            label = " ".join(parts[1:])   # everything after the leading number

            if label == "pages managed":
                pages_total = int(parts[0])
            elif label == "pages free":
                pages_free = int(parts[0])

        used_percent = None
        if pages_total and pages_free is not None:
            used_percent = round((pages_total - pages_free) / pages_total * 100, 2)

        swap_output = run_command(ssh_client, GET_SWAP)
        swap_used_percent = self._parse_swap(swap_output)

        return {
            "pages_total": pages_total,
            "pages_free": pages_free,
            "used_percent": used_percent,
            "swap_used_percent": swap_used_percent,
        }

    def _parse_swap(self, output: str) -> float | None:
        lines = output.strip().splitlines()
        if len(lines) < 2:
            return None  # no swap configured
        parts = lines[1].split()
        return float(parts[4].strip("%")) if len(parts) >= 5 else None

    def _get_disk_usage(self, ssh_client) -> List[Dict[str, Any]]:
        output = run_command(ssh_client, GET_DISK_USAGE)
        disks = []
        for line in output.strip().splitlines()[1:]:  # skip header
            parts = line.split()
            if len(parts) >= 6:
                disks.append({
                    "filesystem": parts[0],
                    "size_kb": int(parts[1]),
                    "used_kb": int(parts[2]),
                    "avail_kb": int(parts[3]),
                    "capacity_percent": int(parts[4].strip("%")),
                    "mounted_on": parts[5],
                })
        return disks

    def _get_uptime(self, ssh_client) -> Dict[str, str]:
        output = run_command(ssh_client, GET_UPTIME)
        boot_time = output.split("=", 1)[1].strip()
        return {"boot_time": boot_time}