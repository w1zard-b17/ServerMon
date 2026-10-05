# firewall.py - pf enabled/disabled, active rule count, state table anomalies

from collectors.base import Collector
from connection.ssh_client import run_command
from typing import Dict, Any
from config.constants import (
    GET_PF_INFO,
    GET_PF_RULES,
)


class FirewallCheck(Collector):
    name = "firewall.check"

    def run(self, ssh_client) -> Dict[str, Any]:
        info = self._get_pf_info(ssh_client)
        return {
            "pf_enabled": info["enabled"],
            "state_table": info["state_table"],
            "rule_count": self._get_rule_count(ssh_client),
        }

    def _get_pf_info(self, ssh_client) -> Dict[str, Any]:
        output = run_command(ssh_client, GET_PF_INFO)
        enabled = "Status: Enabled" in output

        current_entries = None
        for line in output.splitlines():
            if "current entries" in line:
                parts = line.split()
                if parts:
                    current_entries = int(parts[-1])

        return {
            "enabled": enabled,
            "state_table": {"current_entries": current_entries},
        }

    def _get_rule_count(self, ssh_client) -> int:
        output = run_command(ssh_client, GET_PF_RULES)
        lines = [l for l in output.strip().splitlines() if l.strip() and not l.strip().startswith("#")]
        return len(lines)