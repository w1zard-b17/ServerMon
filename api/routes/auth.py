# routes/auth.py - enrolment, login, elevation, logout

import time

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from api import auth
from api.guards import session_state, client_ip, error, json_body, CSRF_HEADER
from config.constants import DASHBOARD_ELEVATION_SECONDS


def _csrf_ok(request: Request) -> bool:
    return request.headers.get(CSRF_HEADER) == "1"


async def status(request: Request):
    enrolled = await run_in_threadpool(auth.is_enrolled)
    return JSONResponse({"enrolled": enrolled, **session_state(request)})


async def enroll_start(request: Request):
    if not _csrf_ok(request):
        return error("missing request header", 400)
    ip = client_ip(request)
    if wait := auth.throttle.retry_after(ip):
        return error("too many attempts", 429, retry_after=wait)

    body = await json_body(request)
    secret = await run_in_threadpool(auth.bootstrap.start, str(body.get("token", "")))
    if not secret:
        auth.throttle.fail(ip)
        return error("invalid or expired enrolment token", 403)
    return JSONResponse({"uri": auth.provisioning_uri(secret), "secret": secret})


async def enroll_confirm(request: Request):
    if not _csrf_ok(request):
        return error("missing request header", 400)
    ip = client_ip(request)
    if wait := auth.throttle.retry_after(ip):
        return error("too many attempts", 429, retry_after=wait)

    body = await json_body(request)
    ok = await run_in_threadpool(auth.bootstrap.confirm, str(body.get("token", "")), str(body.get("code", "")))
    if not ok:
        auth.throttle.fail(ip)
        return error("code did not match, check the app and the device clock", 403)
    auth.throttle.succeed(ip)
    request.session.clear()
    request.session["auth_at"] = time.time()
    return JSONResponse(session_state(request))


async def login(request: Request):
    if not _csrf_ok(request):
        return error("missing request header", 400)
    body = await json_body(request)
    result = await run_in_threadpool(auth.verify_code, client_ip(request), str(body.get("code", "")))
    if not result["ok"]:
        if result["retry_after"]:
            return error("too many attempts", 429, retry_after=result["retry_after"])
        return error("invalid code", 401)
    request.session.clear()   # new session on every login
    request.session["auth_at"] = time.time()
    return JSONResponse(session_state(request))


async def elevate(request: Request):
    if not _csrf_ok(request):
        return error("missing request header", 400)
    if not session_state(request)["authenticated"]:
        return error("unauthorized", 401)
    body = await json_body(request)
    result = await run_in_threadpool(auth.verify_code, client_ip(request), str(body.get("code", "")))
    if not result["ok"]:
        if result["retry_after"]:
            return error("too many attempts", 429, retry_after=result["retry_after"])
        return error("invalid code", 401)
    request.session["elevated_until"] = time.time() + DASHBOARD_ELEVATION_SECONDS
    return JSONResponse(session_state(request))


async def logout(request: Request):
    if not _csrf_ok(request):
        return error("missing request header", 400)
    request.session.clear()
    return JSONResponse({"authenticated": False})


routes = [
    Route("/api/auth/status", status),
    Route("/api/auth/enroll/start", enroll_start, methods=["POST"]),
    Route("/api/auth/enroll/confirm", enroll_confirm, methods=["POST"]),
    Route("/api/auth/login", login, methods=["POST"]),
    Route("/api/auth/elevate", elevate, methods=["POST"]),
    Route("/api/auth/logout", logout, methods=["POST"]),
]
