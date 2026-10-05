# routes/hosts.py - fleet overview and host detail

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from api import status
from api.guards import login_required, error


def _fleet():
    snapshot = status.Snapshot()
    return {
        "overview": status.overview(snapshot),
        "hosts": [status.host_summary(snapshot, h) for h in snapshot.inventory],
    }


def _detail(name: str):
    snapshot = status.Snapshot()
    host = next((h for h in snapshot.inventory if h["name"] == name), None)
    return status.host_detail(snapshot, host) if host else None


@login_required()
async def fleet(request: Request):
    return JSONResponse(await run_in_threadpool(_fleet))


@login_required()
async def detail(request: Request):
    data = await run_in_threadpool(_detail, request.path_params["name"])
    if data is None:
        return error("unknown host", 404)
    return JSONResponse(data)


routes = [
    Route("/api/fleet", fleet),
    Route("/api/hosts/{name}", detail),
]
