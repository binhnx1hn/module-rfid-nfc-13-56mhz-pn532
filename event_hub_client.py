"""
event_hub_client.py — REST client for posting card events to the Event Hub.

Sends structured card reader events to POST /events/ingest with a 5-second
timeout. Returns parsed ACK dict or error dict on failure.

Environment variables:
    EVENT_HUB_URL: Target ingest endpoint (default: http://192.168.21.47:8000/events/ingest)
    READER_ID:     Reader device identifier (default: CR-001)
    LOCATION:      Physical location identifier (default: main_entrance)
"""

import os
import logging
import requests

logger = logging.getLogger(__name__)

EVENT_HUB_URL = os.getenv("EVENT_HUB_URL", "http://192.168.21.47:8000/events/ingest")

_DEFAULT_READER_ID = os.getenv("READER_ID", "CR-001")
_DEFAULT_LOCATION = os.getenv("LOCATION", "main_entrance")

_HEADERS = {
    "accept": "application/json",
    "Content-Type": "application/json",
}


def send_card_event(
    card_id: str,
    person_id: str,
    person_name: str,
    access: bool,
    action: str = "entry",
    location: str = None,
    reader_id: str = None,
) -> dict:
    """Build and POST a card reader event to the Event Hub.

    Args:
        card_id:     Uppercase hex UID string (e.g. "DB8A4806").
        person_id:   Employee/user ID from card registry (e.g. "EMP001").
        person_name: Human-readable name (e.g. "Nguyen Van A").
        access:      True if card is authorised, False otherwise.
        action:      Event action string, default "entry".
        location:    Physical location identifier, defaults to LOCATION env var.
        reader_id:   Reader device identifier, defaults to READER_ID env var.

    Returns:
        Parsed JSON dict from Event Hub (e.g. {"status": "ok", "event_id": ...})
        or {"status": "error", "detail": <reason>} on failure.
    """
    if reader_id is None:
        reader_id = _DEFAULT_READER_ID
    if location is None:
        location = _DEFAULT_LOCATION

    message = "Quet the thanh cong" if access else "The khong hop le"

    payload = {
        "source": "card_reader_01",
        "type": "card_reader",
        "priority": "high",
        "payload": {
            "card_id": card_id,
            "person_id": person_id,
            "person_name": person_name,
            "action": action,
            "location": location,
            "reader_id": reader_id,
            "access": access,
            "message": message,
        },
    }

    try:
        response = requests.post(EVENT_HUB_URL, json=payload, headers=_HEADERS, timeout=5)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        logger.error(f"[EventHubClient] HTTP error: {e}")
        return {"status": "error", "detail": str(e)}
    except requests.exceptions.ConnectionError as e:
        logger.error(f"[EventHubClient] Connection error: {e}")
        return {"status": "error", "detail": "connection_failed"}
    except requests.exceptions.RequestException as e:
        logger.error(f"[EventHubClient] Request error: {e}")
        return {"status": "error", "detail": str(e)}
