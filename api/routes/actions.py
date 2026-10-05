# routes/actions.py - on-demand scan, service control and power actions

import threading

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from api.guards import login_required, error, json_body
from config.constants import TIMING_BY_TIERS, SERVICE_OPS
from config.settings import load_inventory
from control import service_control
from control.service_control import ControlError

_scan_lock = threading.Lock()   # one on-demand scan at a time


def _known(name: str) -> bool:
    return any(h["name"] == name for h in load_inventory())


def _scan(name: str, tiers):
    from core import engine   # needs the monitor keys, so imported on use
    if not _scan_lock.acquire(blocking=False):
        return None
    try:
        results = []
        for tier in tiers:
            report = engine.run_cycle(tier, host_names=[name])
            results.append({"tier": tier, "alerts_fired": report["alerts_fired"], "errors": report["errors"]})
        return results
    finally:
        _scan_lock.release()


@login_required()
async def scan(request: Request):
    name = request.path_params["name"]
    if not _known(name):
        return error("unknown host", 404)
    body = await json_body(request)
    tier = body.get("tier", "all")
    tiers = list(TIMING_BY_TIERS) if tier == "all" else [tier]
    if any(t not in TIMING_BY_TIERS for t in tiers):
        return error("unknown tier", 400)

    try:
        results = await run_in_threadpool(_scan, name, tiers)
    except FileNotFoundError as e:
        return error(str(e), 500)
    if results is None:
        return error("a scan is already running", 409)
    return JSONResponse({"host": name, "results": results})


@login_required(elevated=True)
async def service(request: Request):
    name = request.path_params["name"]
    body = await json_body(request)
    op, svc = str(body.get("op", "")), str(body.get("service", ""))
    if op not in SERVICE_OPS:
        return error("unknown operation", 400)
    if not service_control.valid_service_name(svc):
        return error("invalid service name", 400)
    try:
        output = await run_in_threadpool(service_control.service_action, name, svc, op)
    except ControlError as e:
        return error(str(e), 502)
    return JSONResponse({"host": name, "service": svc, "op": op, "output": output})


@login_required(elevated=True)
async def power(request: Request):
    name = request.path_params["name"]
    body = await json_body(request)
    op = str(body.get("op", ""))
    if body.get("confirm") != name:   # the user types the host name to confirm
        return error("confirmation does not match host name", 400)
    try:
        await run_in_threadpool(service_control.power_action, name, op)
    except ControlError as e:
        return error(str(e), 502)
    return JSONResponse({"host": name, "op": op, "accepted": True})


routes = [
    Route("/api/hosts/{name}/scan", scan, methods=["POST"]),
    Route("/api/hosts/{name}/service", service, methods=["POST"]),
    Route("/api/hosts/{name}/power", power, methods=["POST"]),
]
