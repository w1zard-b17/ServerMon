# host_manager.py - host inventory and per-tier data collection

import paramiko
import socket
from typing import Dict, Any, List

from connection.ssh_client import create_client
from config.tasks import TASKS_BY_TIER
from config.settings import load_hosts

_HOSTS_CACHE: List[Dict[str, Any]] = None


def get_hosts() -> List[Dict[str, Any]]:
    '''returns the host inventory, loaded from hosts.yaml once and cached'''
    global _HOSTS_CACHE
    if _HOSTS_CACHE is None:
        _HOSTS_CACHE = load_hosts()
    return _HOSTS_CACHE


def get_hosts_for_tier(tier: str) -> List[Dict[str, Any]]:
    return [h for h in get_hosts() if tier in h.get("tiers", [])]


def collect(host: Dict[str, Any], tier: str) -> Dict[str, Any]:
    '''runs every collector of a tier against one host over a single SSH connection'''
    collectors = TASKS_BY_TIER.get(tier, [])
    if not collectors:
        return {"host": host["name"], "connected": False, "error": f"no collectors defined for tier '{tier}'", "results": {}}

    try:
        client = create_client(host["ip"], host["ssh_user"], host["key_path"])
    except paramiko.AuthenticationException:
        return {"host": host["name"], "connected": False, "error": "authentication failed", "results": {}}
    except (paramiko.SSHException, socket.error, socket.timeout) as e:
        return {"host": host["name"], "connected": False, "error": f"connection failed: {e}", "results": {}}

    try:
        results = {}
        for collector in collectors:
            results[collector.name] = collector.safe_run(client)
        return {"host": host["name"], "connected": True, "error": None, "results": results}
    finally:
        client.close()


def collect_all(tier: str, host_names: List[str] = None) -> List[Dict[str, Any]]:
    '''runs collect() on every host in the tier, or only on the named ones'''
    return [
        collect(host, tier)
        for host in get_hosts_for_tier(tier)
        if host_names is None or host["name"] in host_names
    ]
