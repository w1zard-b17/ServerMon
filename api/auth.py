# auth.py - authenticator app (TOTP, RFC 6238) login for the dashboard
#
# one authenticator is enrolled with a one-time token printed on the server console.
# codes are single use and failures are rate limited. shell and control actions need a
# second fresh code. `python -m api.auth reset` wipes the enrolment.

import base64
import hashlib
import hmac
import secrets
import struct
import sys
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from storage.db import get_connection, init_db
from config.constants import (
    TOTP_ISSUER, TOTP_PERIOD, TOTP_DIGITS, TOTP_WINDOW,
    LOGIN_MAX_FAILURES_PER_IP, LOGIN_LOCKOUT_SECONDS, LOGIN_MAX_FAILURES_GLOBAL,
)


# --- TOTP PRIMITIVES ---

def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10 ** TOTP_DIGITS).zfill(TOTP_DIGITS)


def _match_counter(secret: str, code: str, now: Optional[float] = None) -> Optional[int]:
    '''returns the time step the code belongs to, or None'''
    if not (code.isdigit() and len(code) == TOTP_DIGITS):
        return None
    current = int((now or time.time()) // TOTP_PERIOD)
    for step in range(current - TOTP_WINDOW, current + TOTP_WINDOW + 1):
        if hmac.compare_digest(_hotp(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, account: str = "admin") -> str:
    label = quote(f"{TOTP_ISSUER}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(TOTP_ISSUER)}&digits={TOTP_DIGITS}&period={TOTP_PERIOD}"


# --- PERSISTED STATE ---

def _row():
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM dashboard_auth WHERE id = 1").fetchone()
        if row is None:
            conn.execute("INSERT INTO dashboard_auth (id, session_key) VALUES (1, ?)", (secrets.token_hex(32),))
            conn.commit()
            row = conn.execute("SELECT * FROM dashboard_auth WHERE id = 1").fetchone()
        return dict(row)
    finally:
        conn.close()


def session_key() -> str:
    return _row()["session_key"]


def is_enrolled() -> bool:
    return bool(_row()["totp_secret"])


def _save_enrolment(secret: str, counter: int) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE dashboard_auth SET totp_secret = ?, last_counter = ?, enrolled_at = ? WHERE id = 1",
            (secret, counter, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def _consume_code(code: str) -> bool:
    '''checks a code and burns its time step so it cannot be reused'''
    row = _row()
    if not row["totp_secret"]:
        return False
    step = _match_counter(row["totp_secret"], code)
    if step is None or step <= row["last_counter"]:
        return False
    conn = get_connection()
    try:
        # conditional update so two requests with the same code cannot both pass
        cur = conn.execute(
            "UPDATE dashboard_auth SET last_counter = ? WHERE id = 1 AND last_counter < ?", (step, step)
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def reset_enrolment() -> None:
    conn = get_connection()
    try:
        # a new session key also invalidates every existing session
        conn.execute(
            "UPDATE dashboard_auth SET totp_secret = NULL, last_counter = 0, enrolled_at = NULL, session_key = ? WHERE id = 1",
            (secrets.token_hex(32),),
        )
        conn.commit()
    finally:
        conn.close()


# --- BOOTSTRAP (first-time enrolment) ---

class Bootstrap:
    '''one-time enrolment token (memory only) and the secret being enrolled'''

    def __init__(self):
        self.token: Optional[str] = None
        self.pending_secret: Optional[str] = None

    def open(self) -> Optional[str]:
        if is_enrolled():
            self.token = None
            return None
        self.token = secrets.token_urlsafe(18)
        self.pending_secret = None
        return self.token

    def check_token(self, token: str) -> bool:
        return bool(self.token) and hmac.compare_digest(self.token, token or "")

    def start(self, token: str) -> Optional[str]:
        if is_enrolled() or not self.check_token(token):
            return None
        self.pending_secret = self.pending_secret or new_secret()
        return self.pending_secret

    def confirm(self, token: str, code: str) -> bool:
        if is_enrolled() or not self.check_token(token) or not self.pending_secret:
            return False
        step = _match_counter(self.pending_secret, code)
        if step is None:
            return False
        _save_enrolment(self.pending_secret, step)
        self.token = self.pending_secret = None
        return True


bootstrap = Bootstrap()


# --- RATE LIMITING ---

class Throttle:
    '''sliding window failure counter per client IP, plus a global limit'''

    def __init__(self):
        self._per_ip = defaultdict(deque)
        self._global = deque()

    def _prune(self, q: deque, now: float) -> None:
        while q and now - q[0] > LOGIN_LOCKOUT_SECONDS:
            q.popleft()

    def retry_after(self, ip: str) -> int:
        '''seconds until this client may try again, 0 if allowed now'''
        now = time.time()
        q = self._per_ip[ip]
        self._prune(q, now)
        self._prune(self._global, now)
        waits = []
        if len(q) >= LOGIN_MAX_FAILURES_PER_IP:
            waits.append(LOGIN_LOCKOUT_SECONDS - (now - q[0]))
        if len(self._global) >= LOGIN_MAX_FAILURES_GLOBAL:
            waits.append(LOGIN_LOCKOUT_SECONDS - (now - self._global[0]))
        return int(max(waits)) + 1 if waits else 0

    def fail(self, ip: str) -> None:
        now = time.time()
        self._per_ip[ip].append(now)
        self._global.append(now)

    def succeed(self, ip: str) -> None:
        self._per_ip.pop(ip, None)


throttle = Throttle()


def verify_code(ip: str, code: str) -> dict:
    '''checks a code with rate limiting, returns {"ok", "retry_after"}'''
    wait = throttle.retry_after(ip)
    if wait:
        return {"ok": False, "retry_after": wait}
    if _consume_code((code or "").strip()):
        throttle.succeed(ip)
        return {"ok": True, "retry_after": 0}
    throttle.fail(ip)
    return {"ok": False, "retry_after": throttle.retry_after(ip)}


if __name__ == "__main__":
    init_db()
    if sys.argv[1:] == ["reset"]:
        reset_enrolment()
        print("[auth] enrolment wiped, restart the API to get a new token")
    else:
        print(f"[auth] enrolled: {is_enrolled()}")
        print("usage: python -m api.auth reset")
