# db.py - SQLite connection and schema initialization

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("SERVERMON_DB", Path(__file__).parent / "servermon.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS hosts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT UNIQUE NOT NULL,
    ip            TEXT NOT NULL,
    role          TEXT,
    first_seen    TEXT NOT NULL,
    last_seen     TEXT
);

CREATE TABLE IF NOT EXISTS metrics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    host_name     TEXT NOT NULL,
    tier          TEXT NOT NULL,
    collector     TEXT NOT NULL,
    status        TEXT NOT NULL,
    data          TEXT,
    message       TEXT,
    recorded_at   TEXT NOT NULL,
    FOREIGN KEY (host_name) REFERENCES hosts(name)
);

CREATE INDEX IF NOT EXISTS idx_metrics_host_time ON metrics(host_name, recorded_at);
CREATE INDEX IF NOT EXISTS idx_metrics_collector ON metrics(collector, recorded_at);

CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    host_name     TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    description   TEXT,
    recorded_at   TEXT NOT NULL,
    FOREIGN KEY (host_name) REFERENCES hosts(name)
);

CREATE INDEX IF NOT EXISTS idx_events_time ON events(recorded_at);
CREATE INDEX IF NOT EXISTS idx_events_host_time ON events(host_name, recorded_at);

-- single row: the enrolled authenticator secret and the session signing key
CREATE TABLE IF NOT EXISTS dashboard_auth (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    totp_secret   TEXT,
    last_counter  INTEGER NOT NULL DEFAULT 0,   -- last accepted TOTP step, blocks replay
    session_key   TEXT NOT NULL,
    enrolled_at   TEXT
);
"""


def get_connection() -> sqlite3.Connection:
    '''returns a connection with foreign keys enforced and rows that behave like dicts'''
    conn = sqlite3.connect(DB_PATH, timeout=10)   # engine and dashboard write from separate processes
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    '''creates tables and indexes if missing, safe to call on every startup'''
    conn = get_connection()
    try:
        conn.execute("PRAGMA journal_mode = WAL")   # readers keep working while the engine writes
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()