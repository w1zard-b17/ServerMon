# routes/metrics.py - metric history for one host

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from api import status
from api.guards import login_required
from config.constants import RETENTION_DAYS


@login_required()
async def trends(request: Request):
    try:
        hours = int(request.query_params.get("hours", 24))
    except ValueError:
        hours = 24
    hours = max(1, min(hours, RETENTION_DAYS["medium"] * 24))
    return JSONResponse(await run_in_threadpool(status.trends, request.path_params["name"], hours))


routes = [
    Route("/api/hosts/{name}/trends", trends),
]
