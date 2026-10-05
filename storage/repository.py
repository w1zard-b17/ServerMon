# repository.py - read/write helpers for hosts, metrics, and events

import json
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

from storage.db import get_connection
from config.constants import RETENTION_DAYS, EVENTS_RETENTION_DAYS


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_host(name: str, ip: str, role: str = None) -> None:
    '''inserts a host if new, otherwise refreshes its address and last_seen'''
    conn = get_connection()
    try:
        now = _now()
        conn.execute(
            """
            INSERT INTO hosts (name, ip, role, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                ip = excluded.ip,
                role = excluded.role,
                last_seen = excluded.last_seen
            """,
            (name, ip, role, now, now),
        )
        conn.commit()
    finally:
        conn.close()


def store_metric(host_name: str, tier: str, collector: str, status: str, data: Dict[str, Any] = None, message: str = None) -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO metrics (host_name, tier, collector, status, data, message, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (host_name, tier, collector, status, json.dumps(data) if data is not None else None, message, _now()),
        )
        conn.commit()
    finally:
        conn.close()


def store_event(host_name: str, event_type: str, description: str = None) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO events (host_name, event_type, description, recorded_at) VALUES (?, ?, ?, ?)",
            (host_name, event_type, description, _now()),
        )
        conn.commit()
    finally:
        conn.close()


def get_host_rows() -> Dict[str, Dict[str, Any]]:
    '''every row of the hosts table, keyed by host name'''
    conn = get_connection()
    try:
        return {row["name"]: dict(row) for row in conn.execute("SELECT * FROM hosts")}
    finally:
        conn.close()


def get_latest_metrics_all() -> List[Dict[str, Any]]:
    '''newest metric row per (host, collector), with data decoded'''
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT m.* FROM metrics m
            INNER JOIN (
                SELECT host_name, collector, MAX(recorded_at) AS latest
                FROM metrics
                GROUP BY host_name, collector
            ) l ON m.host_name = l.host_name AND m.collector = l.collector AND m.recorded_at = l.latest
            """
        ).fetchall()
        return [_decode(row) for row in rows]
    finally:
        conn.close()


def get_metric_history(host_name: str, collector: str, since: str) -> List[Dict[str, Any]]:
    '''every ok row for one host and collector since an ISO timestamp, oldest first'''
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT recorded_at, data FROM metrics
            WHERE host_name = ? AND collector = ? AND status = 'ok' AND recorded_at >= ?
            ORDER BY recorded_at
            """,
            (host_name, collector, since),
        ).fetchall()
        return [_decode(row) for row in rows]
    finally:
        conn.close()


def get_events(since: str = None, host_name: str = None, type_prefix: str = None, limit: int = 5000) -> List[Dict[str, Any]]:
    '''events newest first, optionally filtered by time, host and event_type prefix'''
    query, params = "SELECT * FROM events WHERE 1 = 1", []
    if since:
        query += " AND recorded_at >= ?"
        params.append(since)
    if host_name:
        query += " AND host_name = ?"
        params.append(host_name)
    if type_prefix:
        query += " AND event_type LIKE ?"
        params.append(type_prefix + "%")
    query += " ORDER BY recorded_at DESC, id DESC LIMIT ?"
    params.append(limit)

    conn = get_connection()
    try:
        return [dict(row) for row in conn.execute(query, params)]
    finally:
        conn.close()


def get_last_event_times(event_type: str) -> Dict[str, str]:
    '''host -> time of its newest event of this type'''
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT host_name, MAX(recorded_at) AS latest FROM events WHERE event_type = ? GROUP BY host_name",
            (event_type,),
        )
        return {row["host_name"]: row["latest"] for row in rows}
    finally:
        conn.close()


def get_last_run_times() -> Dict[str, Dict[str, str]]:
    '''host -> tier -> time of the newest metric row'''
    conn = get_connection()
    try:
        rows = conn.execute("SELECT host_name, tier, MAX(recorded_at) AS latest FROM metrics GROUP BY host_name, tier")
        runs: Dict[str, Dict[str, str]] = {}
        for row in rows:
            runs.setdefault(row["host_name"], {})[row["tier"]] = row["latest"]
        return runs
    finally:
        conn.close()


def _decode(row) -> Dict[str, Any]:
    item = dict(row)
    if item.get("data") is not None:
        item["data"] = json.loads(item["data"])
    return item


def purge_old_metrics() -> Dict[str, int]:
    '''deletes metric rows past their tier retention, returns rows deleted per tier'''
    conn = get_connection()
    deleted = {}
    try:
        for tier, days in RETENTION_DAYS.items():
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            cur = conn.execute(
                "DELETE FROM metrics WHERE tier = ? AND recorded_at < ?",
                (tier, cutoff),
            )
            deleted[tier] = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    return deleted


def purge_old_events() -> int:
    conn = get_connection()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=EVENTS_RETENTION_DAYS)).isoformat()
        cur = conn.execute("DELETE FROM events WHERE recorded_at < ?", (cutoff,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()