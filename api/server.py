# server.py - dashboard web server (API and built frontend)
#
# run from the project root as the user that owns the SSH keys:  python -m api.server
# it runs alongside the engine (main.py) and shares the same SQLite database.

import contextlib
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from api import auth
from api.guards import LanOnlyMiddleware, SecurityHeadersMiddleware
from api.routes import auth as auth_routes, hosts, metrics, alerts, actions, shell
from config.constants import DASHBOARD_BIND, DASHBOARD_PORT, DASHBOARD_SESSION_HOURS, DASHBOARD_HTTPS_ONLY
from storage.db import init_db

DIST_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "dist"


class SpaStaticFiles(StaticFiles):
    '''serves the built dashboard, unknown paths fall back to index.html for client side routing'''

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as e:
            if e.status_code != 404:
                raise
            return FileResponse(DIST_DIR / "index.html")


async def api_not_found(request):
    return JSONResponse({"error": "not found"}, status_code=404)


def _announce_bootstrap() -> None:
    token = auth.bootstrap.open()
    if token:
        print("=" * 64)
        print("[auth] no authenticator enrolled yet, open the dashboard and use this one-time token:")
        print(f"[auth]     {token}")
        print("[auth] it is valid until enrolment completes or this process restarts.")
        print("=" * 64)
    else:
        print("[auth] authenticator enrolled, enrolment is closed (reset: python -m api.auth reset)")


@contextlib.asynccontextmanager
async def lifespan(app):
    _announce_bootstrap()
    yield


def build_app() -> Starlette:
    init_db()

    routes = [
        *auth_routes.routes,
        *hosts.routes,
        *metrics.routes,
        *alerts.routes,
        *actions.routes,
        *shell.routes,
        Route("/api/{rest:path}", api_not_found),
    ]
    if DIST_DIR.exists():
        routes.append(Mount("/", app=SpaStaticFiles(directory=DIST_DIR, html=True), name="dashboard"))

    middleware = [
        Middleware(LanOnlyMiddleware),
        Middleware(SecurityHeadersMiddleware),
        Middleware(
            SessionMiddleware,
            secret_key=auth.session_key(),
            session_cookie="servermon_session",
            max_age=DASHBOARD_SESSION_HOURS * 3600,
            same_site="strict",
            https_only=DASHBOARD_HTTPS_ONLY,
        ),
    ]
    return Starlette(routes=routes, middleware=middleware, lifespan=lifespan)


app = build_app()


if __name__ == "__main__":
    uvicorn.run(app, host=DASHBOARD_BIND, port=DASHBOARD_PORT, proxy_headers=False, server_header=False)
