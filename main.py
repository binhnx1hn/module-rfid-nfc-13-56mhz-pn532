"""
main.py — Main loop for PN532 Card Reader → Event Hub integration.

Orchestrates PN532Reader, card_registry, and event_hub_client to form a
complete card-access pipeline: read UID → lookup user → send event → control
barrier.

Exports:
    reader_loop(queue, loop, app_state): daemon-thread target used by app.py.

Run standalone with:
    source .venv/bin/activate
    python main.py
"""

import asyncio
import threading
import logging
from datetime import datetime

from pn532_reader import PN532Reader
from card_registry import lookup_card, normalize_uid
from event_hub_client import send_card_event

logger = logging.getLogger(__name__)


def reader_loop(queue: asyncio.Queue, loop: asyncio.AbstractEventLoop, app_state: dict) -> None:
    """Runs in daemon thread. Polls PN532, builds events, pushes to asyncio.Queue.

    Args:
        queue:      asyncio.Queue shared with the FastAPI event loop.
        loop:       The running asyncio event loop (from app.py lifespan).
        app_state:  Shared mutable dict with keys: reader_status, total_scans, lock.
    """
    try:
        reader = PN532Reader()
        app_state["reader_status"] = "ok"
    except Exception as e:
        logger.error(f"PN532 init failed: {e}")
        app_state["reader_status"] = "error"
        return

    while True:
        try:
            uid_bytes = reader.read_uid()
            if uid_bytes is None:
                continue

            card_id = normalize_uid(uid_bytes)
            user = lookup_card(card_id)

            result = send_card_event(
                card_id=card_id,
                person_id=user["person_id"],
                person_name=user["person_name"],
                access=user["access"],
            )

            event = {
                "timestamp": datetime.utcnow().isoformat(),
                "card_id": card_id,
                "person_name": user["person_name"],
                "person_id": user["person_id"],
                "access": user["access"],
                "hub_status": result.get("status", "error"),
                "message": "Quet the thanh cong" if user["access"] else "The khong hop le",
            }

            with app_state["lock"]:
                app_state["total_scans"] += 1

            loop.call_soon_threadsafe(queue.put_nowait, event)

            if user["access"] and result.get("status") == "ok":
                logger.info(f"[OPEN BARRIER] {card_id} - {user['person_name']}")
            else:
                logger.info(f"[ACCESS DENIED] {card_id}")

        except Exception as e:
            logger.error(f"Reader loop error: {e}")


# Standalone mode — runs without FastAPI
if __name__ == "__main__":
    import time

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    logger.info("Starting PN532 Card Reader (standalone mode)...")

    state = {
        "reader_status": "initializing",
        "total_scans": 0,
        "lock": threading.Lock(),
    }
    loop = asyncio.new_event_loop()
    q = asyncio.Queue()
    reader_loop(q, loop, state)
