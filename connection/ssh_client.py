# ssh_client.py - opens SSH connections and runs commands on remote hosts

import paramiko

from config.constants import SSH_CONN_TIMEOUT


def create_client(host_ip: str, username: str, key_path: str, connect_timeout: int = SSH_CONN_TIMEOUT) -> paramiko.SSHClient:
    '''opens and returns an authenticated SSH client for the given host'''
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host_ip,
        username=username,
        key_filename=key_path,
        look_for_keys=False,
        allow_agent=False,
        timeout=connect_timeout,
    )
    return client


def run_command(client: paramiko.SSHClient, command: str, timeout: int = 30) -> str:
    '''runs a single command over an open client and returns stdout'''
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    output = stdout.read().decode("utf-8", errors="ignore")
    error = stderr.read().decode("utf-8", errors="ignore")

    if exit_status != 0:
        raise RuntimeError(f"command '{command}' failed (exit {exit_status}): {error.strip()}")

    return output
