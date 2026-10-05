# routes/shell.py - browser SSH shell, bridges a websocket to a paramiko PTY channel
#
# browser to server: JSON text frames, {"t": "i", "d": keys} or {"t": "r", "c": cols, "r": rows}
# server to browser: binary frames with terminal output, JSON text frames {"t": "s" or "e", "m": text}

import json

import anyio
from starlette.concurrency import run_in_threadpool
from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from api.guards import session_state, same_origin
from config.constants import SHELL_MAX_SECONDS
from control import service_control
from control.service_control import ControlError
from storage import repository


async def _recv_blocking(channel):
    try:
        return await anyio.to_thread.run_sync(channel.recv, 65536, abandon_on_cancel=True)
    except TypeError:   # anyio < 4.1 uses the older keyword
        return await anyio.to_thread.run_sync(channel.recv, 65536, cancellable=True)


def _int(value, default, low, high):
    try:
        return max(low, min(int(value), high))
    except (TypeError, ValueError):
        return default


async def shell(ws: WebSocket):
    state = session_state(ws)
    if not same_origin(ws) or not state["authenticated"]:
        await ws.close(code=4401)
        return
    if not state["elevated"]:
        await ws.close(code=4403)
        return

    name = ws.path_params["name"]
    cols = _int(ws.query_params.get("cols"), 120, 20, 500)
    rows = _int(ws.query_params.get("rows"), 32, 5, 200)
    await ws.accept()

    try:
        client, channel = await run_in_threadpool(service_control.open_shell, name, cols, rows)
    except ControlError as e:
        await ws.send_text(json.dumps({"t": "e", "m": str(e)}))
        await ws.close()
        return

    await run_in_threadpool(repository.store_event, name, "action", "[shell] session opened")
    await ws.send_text(json.dumps({"t": "s", "m": "connected"}))

    async def pump_out(scope: anyio.CancelScope):
        while True:
            data = await _recv_blocking(channel)
            if not data:
                break
            await ws.send_bytes(data)
        scope.cancel()

    async def pump_in(scope: anyio.CancelScope):
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                if msg.get("t") == "i":
                    await run_in_threadpool(channel.sendall, str(msg.get("d", "")).encode())
                elif msg.get("t") == "r":
                    channel.resize_pty(width=_int(msg.get("c"), cols, 20, 500), height=_int(msg.get("r"), rows, 5, 200))
        except (WebSocketDisconnect, ValueError):
            pass
        scope.cancel()

    try:
        with anyio.move_on_after(SHELL_MAX_SECONDS):
            async with anyio.create_task_group() as tg:
                tg.start_soon(pump_out, tg.cancel_scope)
                tg.start_soon(pump_in, tg.cancel_scope)
    finally:
        channel.close()
        client.close()
        await run_in_threadpool(repository.store_event, name, "action", "[shell] session closed")
        try:
            await ws.send_text(json.dumps({"t": "s", "m": "session closed"}))
            await ws.close()
        except Exception:
            pass


routes = [
    WebSocketRoute("/api/hosts/{name}/shell", shell),
]
