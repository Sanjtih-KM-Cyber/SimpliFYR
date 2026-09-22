import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.live import hub

router = APIRouter(tags=["live"])


@router.websocket("/ws/live")
async def ws_live(
    websocket: WebSocket,
    source: str | None = Query(default=None),
):
    """Real-time stream of processed events (read-only).

    Optional `source` query param filters the stream to one connection. A
    heartbeat keeps idle connections observable; send failures clean up.
    """
    await websocket.accept()
    queue = hub.subscribe()
    try:
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
                continue
            if source and message.get("source") != source:
                continue
            await websocket.send_json(message)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.unsubscribe(queue)
