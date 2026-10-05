# guards.py - middleware and request checks shared by every route
#
# write requests must carry `X-ServerMon: 1`. browsers cannot send a custom header cross-site
# without a CORS preflight, which this API never allows, so together with SameSite=Strict
# cookies this blocks CSRF. websockets compare Origin with Host instead.

import functools
import ipaddress
import time
from typing import Any, Dict

from starlette.requests import HTTPConnection, Request
from starlette.responses import JSONResponse

from config.constants import DASHBOARD_ALLOWED_NETWORKS, DASHBOARD_SESSION_HOURS

_NETWORKS = [ipaddress.ip_network(n) for n in DASHBOARD_ALLOWED_NETWORKS]
CSRF_HEADER = "x-servermon"


def client_ip(conn: HTTPConnection) -> str:
    return conn.client.host if conn.client else "unknown"


def _allowed(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _NETWORKS)


class LanOnlyMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            ip = scope["client"][0] if scope.get("client") else ""
            if not _allowed(ip):
                if scope["type"] == "http":
                    await JSONResponse({"error": "forbidden"}, status_code=403)(scope, receive, send)
                else:
                    await send({"type": "websocket.close", "code": 4403})
                return
        await self.app(scope, receive, send)


_SECURITY_HEADERS = [
    (b"x-frame-options", b"DENY"),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"content-security-policy",
     b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
     b"font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'"),
]


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"] = list(message["headers"]) + _SECURITY_HEADERS
            await send(message)

        await self.app(scope, receive, send_with_headers)


# --- SESSION STATE ---

def session_state(conn: HTTPConnection) -> Dict[str, Any]:
    session = conn.session
    now = time.time()
    auth_at = session.get("auth_at", 0)
    authenticated = bool(auth_at) and now - auth_at < DASHBOARD_SESSION_HOURS * 3600
    elevated_until = session.get("elevated_until", 0) if authenticated else 0
    return {
        "authenticated": authenticated,
        "elevated": elevated_until > now,
        "elevated_until": elevated_until if elevated_until > now else None,
    }


def error(message: str, status: int, **extra) -> JSONResponse:
    return JSONResponse({"error": message, **extra}, status_code=status)


def login_required(elevated: bool = False):
    def decorator(endpoint):
        @functools.wraps(endpoint)
        async def wrapper(request: Request):
            state = session_state(request)
            if not state["authenticated"]:
                return error("unauthorized", 401)
            if request.method not in ("GET", "HEAD") and request.headers.get(CSRF_HEADER) != "1":
                return error("missing request header", 400)
            if elevated and not state["elevated"]:
                return error("elevation_required", 403)
            return await endpoint(request)
        return wrapper
    return decorator


def same_origin(conn: HTTPConnection) -> bool:
    '''websocket CSRF check: the page must come from this same host'''
    origin = conn.headers.get("origin", "")
    host = conn.headers.get("host", "")
    return bool(origin) and origin.split("://", 1)[-1] == host


async def json_body(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except ValueError:
        return {}
