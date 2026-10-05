# service_control.py - privileged actions: service start/stop/restart, reboot, shutdown, shell
#
# connects as the host's admin_user with <host>.admin.key, never as the read-only monitor account

import re
import socket
from typing import Dict, Any

import paramiko

from config.settings import load_inventory, admin_key_path
from config.constants import CMD_SERVICE, CMD_REBOOT, CMD_SHUTDOWN, SERVICE_OPS, SSH_CONN_TIMEOUT
from connection.ssh_client import create_client, run_command
from storage import repository

_SERVICE_NAME = re.compile(r"^[a-z0-9_]{1,64}$")   # rc.d script names only


class ControlError(Exception):
    pass


def valid_service_name(service: str) -> bool:
    return bool(_SERVICE_NAME.match(service))


def get_admin_target(host_name: str) -> Dict[str, Any]:
    '''inventory entry plus admin key for a host, raises ControlError if control is not set up'''
    host = next((h for h in load_inventory() if h["name"] == host_name), None)
    if host is None:
        raise ControlError(f"unknown host '{host_name}'")
    if not host.get("admin_user"):
        raise ControlError(f"no admin_user configured for '{host_name}' in hosts.yaml")
    key = admin_key_path(host_name)
    if not key.exists():
        raise ControlError(f"admin key missing for '{host_name}': expected at {key}")
    return {**host, "admin_key_path": str(key)}


def control_available(host_name: str) -> bool:
    try:
        get_admin_target(host_name)
        return True
    except ControlError:
        return False


def open_admin_client(host_name: str) -> paramiko.SSHClient:
    target = get_admin_target(host_name)
    try:
        return create_client(target["ip"], target["admin_user"], target["admin_key_path"], SSH_CONN_TIMEOUT)
    except paramiko.AuthenticationException:
        raise ControlError("admin authentication failed")
    except (paramiko.SSHException, socket.error, socket.timeout) as e:
        raise ControlError(f"connection failed: {e}")


def _run_admin(host_name: str, command: str, expect_disconnect: bool = False) -> str:
    client = open_admin_client(host_name)
    try:
        return run_command(client, command)
    except (paramiko.SSHException, socket.error, EOFError):
        if expect_disconnect:   # reboot can drop the session before the exit status
            return ""
        raise
    finally:
        client.close()


def service_action(host_name: str, service: str, op: str) -> str:
    if op not in SERVICE_OPS:
        raise ControlError(f"unsupported service operation '{op}'")
    if not valid_service_name(service):
        raise ControlError(f"invalid service name '{service}'")

    command = CMD_SERVICE.format(op=op, service=service)
    try:
        output = _run_admin(host_name, command)
    except RuntimeError as e:
        repository.store_event(host_name, "action_failed", f"[service] {op} {service}: {e}")
        raise ControlError(str(e))
    repository.store_event(host_name, "action", f"[service] {op} {service}")
    return output


def power_action(host_name: str, op: str) -> None:
    commands = {"reboot": CMD_REBOOT, "shutdown": CMD_SHUTDOWN}
    if op not in commands:
        raise ControlError(f"unsupported power operation '{op}'")

    repository.store_event(host_name, "action", f"[power] {op} requested")
    try:
        _run_admin(host_name, commands[op], expect_disconnect=True)
    except RuntimeError as e:
        repository.store_event(host_name, "action_failed", f"[power] {op}: {e}")
        raise ControlError(str(e))


def open_shell(host_name: str, cols: int = 120, rows: int = 32):
    '''returns (client, channel) for an interactive session, the caller closes both'''
    client = open_admin_client(host_name)
    try:
        channel = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
    except paramiko.SSHException as e:
        client.close()
        raise ControlError(f"could not open shell: {e}")
    return client, channel
