"""
card_registry.py — Card UID → user mapping with JSON persistence.
Thread-safe CRUD operations backed by data/cards.json.
"""
import json
import threading
import logging
import os
from typing import Optional, TypedDict

logger = logging.getLogger(__name__)

DATA_FILE = os.getenv("CARDS_DATA_FILE", "data/cards.json")


class CardRecord(TypedDict):
    """Type definition for a card registry entry."""
    person_id: Optional[str]
    person_name: str
    access: bool


_lock = threading.RLock()
_db: dict[str, CardRecord] = {}


def _load() -> None:
    """Load CARD_DB from JSON file. Called once at startup."""
    global _db
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            _db = json.load(f)
        logger.info(f"[CardRegistry] Loaded {len(_db)} cards from {DATA_FILE}")
    except FileNotFoundError:
        logger.warning(f"[CardRegistry] {DATA_FILE} not found, starting empty")
        _db = {}
    except json.JSONDecodeError as e:
        logger.error(f"[CardRegistry] JSON parse error: {e}, starting empty")
        _db = {}


def _save() -> None:
    """Persist _db to JSON file. Must be called under _lock."""
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(_db, f, indent=2, ensure_ascii=False)


def normalize_uid(uid_bytes: bytes) -> str:
    """Convert raw UID bytes to an uppercase hex string without separators."""
    return uid_bytes.hex().upper()


def lookup_card(card_id: str) -> CardRecord:
    """Thread-safe lookup. Never raises."""
    with _lock:
        item = _db.get(card_id)
    if item:
        return dict(item)
    return {"person_id": None, "person_name": "Unknown", "access": False}


def get_all_cards() -> list[dict]:
    """Return all cards as list with card_id injected."""
    with _lock:
        return [{"card_id": k, **v} for k, v in _db.items()]


def add_card(card_id: str, person_id: str, person_name: str, access: bool) -> dict:
    """Add new card. Raises ValueError if card_id already exists."""
    card_id = card_id.upper().replace(" ", "")
    with _lock:
        if card_id in _db:
            raise ValueError(f"card_id {card_id} already exists")
        _db[card_id] = {"person_id": person_id, "person_name": person_name, "access": access}
        _save()
    logger.info(f"[CardRegistry] Added card {card_id} for {person_name}")
    return {"card_id": card_id, "person_id": person_id, "person_name": person_name, "access": access}


def update_card(card_id: str, person_id: str = None, person_name: str = None, access: bool = None) -> dict:
    """Update existing card fields. Raises KeyError if not found."""
    card_id = card_id.upper()
    with _lock:
        if card_id not in _db:
            raise KeyError(f"card_id {card_id} not found")
        if person_id is not None:
            _db[card_id]["person_id"] = person_id
        if person_name is not None:
            _db[card_id]["person_name"] = person_name
        if access is not None:
            _db[card_id]["access"] = access
        _save()
    logger.info(f"[CardRegistry] Updated card {card_id}")
    return {"card_id": card_id, **_db[card_id]}


def delete_card(card_id: str) -> bool:
    """Delete card. Returns True if deleted, False if not found."""
    card_id = card_id.upper()
    with _lock:
        if card_id not in _db:
            return False
        del _db[card_id]
        _save()
    logger.info(f"[CardRegistry] Deleted card {card_id}")
    return True


# Load on import
_load()
