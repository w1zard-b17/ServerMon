# routes/alerts.py - grouped alert records and the similarity graph

from datetime import datetime, timezone, timedelta

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from api import status
from api.guards import login_required
from config.constants import EVENTS_RETENTION_DAYS


def _since(request: Request) -> str:
    try:
        hours = int(request.query_params.get("hours", 168))
    except ValueError:
        hours = 168
    hours = max(1, min(hours, EVENTS_RETENTION_DAYS * 24))
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


@login_required()
async def alerts(request: Request):
    since = _since(request)
    host = request.query_params.get("host") or None

    def load():
        snapshot = status.Snapshot()
        return {"since": since, "groups": status.group_alerts(snapshot, since=since, host=host)}

    return JSONResponse(await run_in_threadpool(load))


@login_required()
async def graph(request: Request):
    since = _since(request)
    return JSONResponse(await run_in_threadpool(lambda: status.alert_graph(status.Snapshot(), since)))


routes = [
    Route("/api/alerts", alerts),
    Route("/api/alerts/graph", graph),
]
