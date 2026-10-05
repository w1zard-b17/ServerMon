# services.py - rcctl-based service status checks

from collectors.base import Collector
from connection.ssh_client import run_command
from typing import Dict, Any, List
from config.constants import (
    GET_FAILED_SERVICES,
    GET_ENABLED_SERVICES,
)


class ServiceCheck(Collector):
    name = "services.check"

    def run(self, ssh_client) -> Dict[str, Any]:
        return {
            "failed_services":  self._get_failed_services(ssh_client),
            "enabled_services": self._get_enabled_services(ssh_client),
        }

    def _get_failed_services(self, ssh_client) -> List[str]:
        output = run_command(ssh_client, GET_FAILED_SERVICES)
        return [line.strip() for line in output.strip().splitlines() if line.strip()]

    def _get_enabled_services(self, ssh_client) -> List[str]:
        output = run_command(ssh_client, GET_ENABLED_SERVICES)
        return [line.strip() for line in output.strip().splitlines() if line.strip()]