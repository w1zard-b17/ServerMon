# settings.py - loads hosts.yaml and resolves SSH key paths

import os
import yaml
from pathlib import Path
from typing import Dict, Any, List

HOSTS_FILE = Path(os.environ.get("SERVERMON_HOSTS_FILE", Path(__file__).parent / "hosts.yaml"))
SSH_KEY_DIR = Path(os.environ.get("SERVERMON_KEY_DIR", Path.home() / ".ssh" / "servermon"))


def load_inventory() -> List[Dict[str, Any]]:
    '''reads hosts.yaml without checking SSH keys (the dashboard only needs the expected hosts)'''
    with open(HOSTS_FILE, "r") as f:
        raw = yaml.safe_load(f) or {}

    return [
        {
            "name": entry["name"],
            "ip": entry["ip"],
            "role": entry.get("role"),
            "ssh_user": entry["ssh_user"],
            "admin_user": entry.get("admin_user"),
            "expected_services": entry.get("expected_services", []),
            "tiers": entry.get("tiers", ["fast", "medium", "slow"]),
        }
        for entry in raw.get("hosts", [])
    ]


def admin_key_path(host_name: str) -> Path:
    '''private key for control actions and the web shell, separate from the read-only key'''
    return SSH_KEY_DIR / f"{host_name}.admin.key"


def load_hosts() -> List[Dict[str, Any]]:
    hosts = []
    for entry in load_inventory():
        key_path = SSH_KEY_DIR / f"{entry['name']}.key"

        if not key_path.exists():
            raise FileNotFoundError(f"SSH key missing for host '{entry['name']}': expected at {key_path}")

        entry["key_path"] = str(key_path)
        hosts.append(entry)

    return hosts
