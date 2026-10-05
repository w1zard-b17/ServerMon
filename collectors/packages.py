# packages.py - outdated packages, pending patches, installed inventory, OS version

from collectors.base import Collector
from connection.ssh_client import run_command
from typing import Dict, Any, List
from config.constants import (
    GET_OUTDATED_PACKAGES,
    GET_PENDING_PATCHES,
    GET_INSTALLED_PACKAGES,
    GET_OS_VERSION,
)

_QUIRKS_PREFIX = "quirks-"
_CONNECTION_ERROR_MARKERS = ("ftp: connect", "Couldn't find any update", ": empty")


class PackageCheck(Collector):
    name = "packages.check"

    def run(self, ssh_client) -> Dict[str, Any]:
        return {
            "outdated_packages": self._get_outdated_packages(ssh_client),
            "pending_patches": self._get_pending_patches(ssh_client),
            "installed_packages": self._get_installed_packages(ssh_client),
            "os_version": self._get_os_version(ssh_client),
        }

    def _get_outdated_packages(self, ssh_client) -> Dict[str, Any]:
        output = run_command(ssh_client, GET_OUTDATED_PACKAGES)
        lines = [l.strip() for l in output.strip().splitlines() if l.strip()]

        mirror_unreachable = any(
            marker in line for line in lines for marker in _CONNECTION_ERROR_MARKERS
        )

        packages = [
            line for line in lines
            if not line.startswith(_QUIRKS_PREFIX)
            and not any(marker in line for marker in _CONNECTION_ERROR_MARKERS)
        ]

        return {
            "count": len(packages),
            "packages": packages,
            "mirror_unreachable": mirror_unreachable,
        }

    def _get_pending_patches(self, ssh_client) -> Dict[str, Any]:
        output = run_command(ssh_client, GET_PENDING_PATCHES)
        patches = [l.strip() for l in output.strip().splitlines() if l.strip()]
        return {"count": len(patches), "patches": patches}

    def _get_installed_packages(self, ssh_client) -> List[str]:
        output = run_command(ssh_client, GET_INSTALLED_PACKAGES)
        return [l.split()[0] for l in output.strip().splitlines() if l.strip()]

    def _get_os_version(self, ssh_client) -> Dict[str, str]:
        output = run_command(ssh_client, GET_OS_VERSION)
        return {"release": output.strip()}