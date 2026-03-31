"""
app.py — FastAPI web server for PN532 Card Reader Dashboard v2.1

Exposes:
    GET    /                        → static/index.html (FE Dev placeholder)
    GET    /api/history             → last 100 card scan events
    GET    /api/cards               → registered cards (live from JSON store)
    GET    /api/status              → reader/hub health + uptime + scan count
    WS     /ws/dashboard            → real-time event stream with 10-event replay
    GET    /api/admin/cards         → admin: list all cards
    POST   /api/admin/cards         → admin: add new card
    PUT    /api/admin/cards/{id}    → admin: update card fields
    DELETE /api/admin/cards/{id}    → admin: delete card

Environment variables:
    EVENT_HUB_URL: upstream event hub (default: http://192.168.21.47:8000/events/ingest)
    READER_ID:     reader device id (default: CR-001)
    LOCATION:      physical location (default: main_entrance)
    LOG_LEVEL:     logging level (default: INFO)
"""

import asyncio
import threading
import time
import logging
import os
from collections import deque
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from card_registry import get_all_cards, add_card, update_card, delete_card
from main import reader_loop

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
history: deque = deque(maxlen=100)
connected_clients: set[WebSocket] = set()
app_state: dict = {
    "reader_status": "initializing",
    "total_scans": 0,
    "lock": threading.Lock(),
    "start_time": time.time(),
}
event_queue: asyncio.Queue = None


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def broadcast_worker(queue: asyncio.Queue) -> None:
    """Consumes events from queue, appends to history, broadcasts to WS clients."""
    while True:
        event = await queue.get()
        history.appendleft(event)
        dead: set[WebSocket] = set()
        for ws in connected_clients:
            try:
                await ws.send_json(event)
            except Exception:
                dead.add(ws)
        connected_clients.difference_update(dead)


async def ping_clients() -> None:
    """Sends keepalive ping to all connected WebSocket clients every 30 s."""
    while True:
        await asyncio.sleep(30)
        dead: set[WebSocket] = set()
        for ws in connected_clients:
            try:
                await ws.send_json({"type": "ping"})
            except Exception:
                dead.add(ws)
        connected_clients.difference_update(dead)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global event_queue
    event_queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    # Start PN532 reader in daemon thread
    t = threading.Thread(
        target=reader_loop,
        args=(event_queue, loop, app_state),
        daemon=True,
    )
    t.start()
    logger.info("PN532 reader thread started")

    # Start broadcast worker and ping task
    worker_task = asyncio.create_task(broadcast_worker(event_queue))
    ping_task = asyncio.create_task(ping_clients())

    yield

    worker_task.cancel()
    ping_task.cancel()
    logger.info("FastAPI shutdown complete")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PN532 Card Reader Dashboard",
    version="2.0.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory="static"), name="static")


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/", response_class=FileResponse)
async def root() -> FileResponse:
    """Serve dashboard SPA."""
    return FileResponse("static/index.html")


@app.get("/admin", response_class=FileResponse)
async def admin_page() -> FileResponse:
    """Serve admin card management page."""
    return FileResponse("static/admin.html")


@app.get("/api/history")
async def get_history() -> dict:
    """Return last 100 card scan events, newest first."""
    return {"count": len(history), "events": list(history)}


# ---------------------------------------------------------------------------
# Pydantic models for admin CRUD
# ---------------------------------------------------------------------------

class CardCreate(BaseModel):
    card_id: str          # uppercase hex, e.g. "A66AB0AA"
    person_id: str
    person_name: str
    access: bool = True


class CardUpdate(BaseModel):
    person_id: Optional[str] = None
    person_name: Optional[str] = None
    access: Optional[bool] = None


@app.get("/api/cards")
async def get_cards() -> dict:
    """Return all registered cards from live JSON-backed store."""
    cards = get_all_cards()
    return {"count": len(cards), "cards": cards}


# ---------------------------------------------------------------------------
# Admin CRUD endpoints
# ---------------------------------------------------------------------------

@app.get("/api/admin/cards")
async def admin_list_cards() -> dict:
    """Admin: return all cards with card_id injected."""
    cards = get_all_cards()
    return {"count": len(cards), "cards": cards}


@app.post("/api/admin/cards", status_code=201)
async def create_card(card: CardCreate) -> dict:
    """Admin: add a new card. Returns 409 if card_id already exists."""
    try:
        result = add_card(card.card_id, card.person_id, card.person_name, card.access)
        return {"status": "ok", "card": result}
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.put("/api/admin/cards/{card_id}")
async def update_card_endpoint(card_id: str, card: CardUpdate) -> dict:
    """Admin: update existing card fields. Returns 404 if not found."""
    try:
        result = update_card(card_id, card.person_id, card.person_name, card.access)
        return {"status": "ok", "card": result}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/admin/cards/{card_id}")
async def delete_card_endpoint(card_id: str) -> dict:
    """Admin: delete a card. Returns 404 if not found."""
    deleted = delete_card(card_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"card_id {card_id} not found")
    return {"status": "ok", "deleted": card_id}


@app.get("/api/status")
async def get_status() -> dict:
    """Return reader/hub health, uptime, and scan counters."""
    last_hub = "unknown"
    if history:
        last_hub = history[0].get("hub_status", "unknown")
    return {
        "reader_status": app_state["reader_status"],
        "hub_status": last_hub,
        "hub_url": os.getenv("EVENT_HUB_URL", "http://192.168.21.47:8000/events/ingest"),
        "total_scans": app_state["total_scans"],
        "uptime_seconds": int(time.time() - app_state["start_time"]),
        "version": "2.0.0",
    }


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Real-time event stream. Replays last 10 events on connect."""
    await websocket.accept()
    connected_clients.add(websocket)
    logger.info(f"WebSocket client connected: {websocket.client}")

    # Replay last 10 events to new client
    for event in list(history)[:10]:
        await websocket.send_json(event)

    try:
        while True:
            await websocket.receive_text()  # keep connection alive, ignore inbound
    except WebSocketDisconnect:
        connected_clients.discard(websocket)
        logger.info(f"WebSocket client disconnected: {websocket.client}")
