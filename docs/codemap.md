# Codemap — PN532 Card Reader System

## Project Root: `/home/admin/pn532-test/`

---

## Backend (Pi 5 — Python) — v2.1

### Hardware Layer
| File | Purpose | Key Symbols |
|------|---------|-------------|
| [`test_pn532_spi.py`](../test_pn532_spi.py) | Original SPI test | `pn532.read_passive_target()` |
| [`pn532_reader.py`](../pn532_reader.py) | Production PN532 reader | `PN532Reader`, `read_uid()`, `DEBOUNCE_SECONDS=2.0` |

### Business Logic
| File | Purpose | Key Symbols |
|------|---------|-------------|
| [`card_registry.py`](../card_registry.py) | UID → user map + JSON persistence | `_db: dict`, `_lock: RLock`, `CardRecord(TypedDict)`, `lookup_card()`, `get_all_cards()`, `add_card()`, `update_card()`, `delete_card()`, `_load()`, `_save()`, `DATA_FILE` (env `CARDS_DATA_FILE`) |
| [`data/cards.json`](../data/cards.json) | Persistent card store | seed: `A66AB0AA/EMP001`, `AABBCCDD/EMP002` |

### Integration
| File | Purpose | Key Symbols |
|------|---------|-------------|
| [`event_hub_client.py`](../event_hub_client.py) | REST POST to Event Hub | `send_card_event()`, `EVENT_HUB_URL` (env), `_DEFAULT_READER_ID` (env), `_DEFAULT_LOCATION` (env) |

### Application Layer — v2.1
| File | Purpose | Key Symbols |
|------|---------|-------------|
| [`main.py`](../main.py) | Reader thread + standalone mode | `reader_loop(queue, loop, app_state)`, `if __name__ == "__main__"` |
| [`app.py`](../app.py) | FastAPI server — REST + WebSocket + Admin CRUD | `app`, `lifespan()`, `broadcast_worker()`, `ping_clients()`, `CardCreate(BaseModel)`, `CardUpdate(BaseModel)`, `create_card()`, `update_card_endpoint()`, `delete_card_endpoint()`, `admin_list_cards()` |

### Infrastructure
| File | Purpose | Key Symbols |
|------|---------|-------------|
| [`Dockerfile`](../Dockerfile) | Container image (python:3.11-slim-bookworm) | `EXPOSE 8080`, `uvicorn app:app`, `libgpiod2` |
| [`docker-compose.yml`](../docker-compose.yml) | Compose stack — Pi 5 device passthrough | `devices: spidev0.0, spidev0.1, gpiochip0`, `group_add: ["989","986"]`, `BLINKA_FORCECHIP=BCM2XXX`, `BLINKA_FORCEBOARD=RASPBERRY_PI_5`, `./data:/app/data` volume |
| [`requirements.txt`](../requirements.txt) | Python deps | `fastapi`, `uvicorn[standard]`, `websockets`, `adafruit-circuitpython-pn532`, `lgpio`, `requests` |

### Docker Pi 5 Notes (Debian Trixie, BCM2712)
- OS: **Debian Trixie** (not Bookworm) — Docker repo added via `https://download.docker.com/linux/debian`
- `adafruit-blinka` on Pi 5 requires `BLINKA_FORCECHIP=BCM2XXX` + `BLINKA_FORCEBOARD=RASPBERRY_PI_5` env vars (auto-detection fails inside container — no `/proc/device-tree` virtual fs)
- `lgpio` required by `adafruit_blinka/microcontroller/bcm2712/pin.py` — add to `requirements.txt`
- `/dev/gpiochip0` must be mounted as device for `lgpio.gpiochip_open(0)` to succeed
- Pi 5 has no `/dev/gpiomem` — uses `/dev/gpiomem0` through `/dev/gpiomem4` (gpio group GID=986)
- `spi` group GID=989, `gpio` group GID=986 — use numeric GIDs in `group_add` (names not in container)
- `admin` user added to `docker` group: `sudo usermod -aG docker admin`

### Frontend — v2.1 (Dashboard + Admin)
| File | Purpose | Key Symbols |
|------|---------|-------------|
| [`static/index.html`](../static/index.html) | Dashboard HTML — 3-section layout (header+nav, live+registry, history) | `#live-log`, `#registry-body`, `#history-body`, `#badge-reader`, `#badge-hub`, `#badge-ws`, `.admin-nav` |
| [`static/style.css`](../static/style.css) | Dark-theme CSS — badges, scan entries, tables, admin form, toast, action buttons, responsive | `.badge-ok/error/warn/gray`, `.scan-entry.allowed/denied`, `@keyframes flash`, `.toast`, `.form-panel`, `.btn-edit`, `.btn-delete`, `.btn-save`, `.btn-cancel`, `.admin-input`, `.nav-link`, `.form-grid`, `.form-group.full-width`, `@media (max-width:768px)`, `@media (max-width:600px)` |
| [`static/app.js`](../static/app.js) | Vanilla JS dashboard logic — WS client, status poll, table renderers | `connectWebSocket()`, `fetchStatus()`, `fetchCards()`, `fetchHistory()`, `prependLiveEntry()`, `prependHistoryRow()`, `renderRegistry()`, `formatTimestamp()`, `formatUptime()` |
| [`static/admin.html`](../static/admin.html) | Admin page — Add Card form (2-col grid: Card ID + Person ID | Person Name full-width | Access full-width) + Card Registry table with inline edit | `#add-card-form`, `.form-grid`, `.full-width`, `#admin-table-body`, `#card-count-badge`, `#toast-container`, `.admin-nav` |
| [`static/admin.js`](../static/admin.js) | Vanilla JS admin CRUD — GET/POST/PUT/DELETE `/api/admin/cards` | `loadCards()`, `addCard()`, `updateCard()`, `deleteCard()`, `renderTable()`, `showToast()`, `enableEditRow()`, `saveEditRow()`, `cancelEditRow()`, `normalizeCardId()`, `escHtml()` |

---

## API-CONTRACT (v2.1)

### Local REST Endpoints (`app.py`)

| Method | Path | Response | Description |
|--------|------|----------|-------------|
| `GET` | `/` | `FileResponse` HTML | Serve `static/index.html` |
| `GET` | `/admin` | `FileResponse` HTML | Serve `static/admin.html` |
| `GET` | `/api/history` | `{"count": int, "events": [...]}` | Last 100 scan events, newest first |
| `GET` | `/api/cards` | `{"count": int, "cards": [...]}` | All cards (live from JSON store) |
| `GET` | `/api/status` | See below | Reader + hub health |
| `WS` | `/ws/dashboard` | JSON stream | Real-time events + 10-event replay on connect |
| `GET` | `/api/admin/cards` | `{"count": int, "cards": [...]}` | Admin: list all cards |
| `POST` | `/api/admin/cards` | `201 {"status":"ok","card":{...}}` | Admin: add card — `409` if duplicate |
| `PUT` | `/api/admin/cards/{card_id}` | `{"status":"ok","card":{...}}` | Admin: update card — `404` if not found |
| `DELETE` | `/api/admin/cards/{card_id}` | `{"status":"ok","deleted":"..."}` | Admin: delete card — `404` if not found |

**`POST /api/admin/cards` request body:**
```json
{"card_id": "A66AB0AA", "person_id": "EMP001", "person_name": "Nguyen Van A", "access": true}
```

**`PUT /api/admin/cards/{card_id}` request body (all fields optional):**
```json
{"person_id": "EMP001", "person_name": "Nguyen Van A", "access": false}
```

**`card_id` rules:** uppercase hex, no spaces, no `0x` prefix. `add_card()` auto-normalizes.

**`GET /api/status` response:**
```json
{
  "reader_status": "ok|error|initializing",
  "hub_status": "ok|error|unknown",
  "hub_url": "http://192.168.21.47:8000/events/ingest",
  "total_scans": 42,
  "uptime_seconds": 3600,
  "version": "2.0.0"
}
```

**`WS /ws/dashboard` event shape:**
```json
{
  "timestamp": "2026-03-31T06:59:41.141Z",
  "card_id": "DB8A4806",
  "person_name": "Nguyen Van A",
  "person_id": "EMP001",
  "access": true,
  "hub_status": "ok",
  "message": "Quet the thanh cong"
}
```

**WebSocket keepalive ping (every 30 s):**
```json
{"type": "ping"}
```

### Upstream — POST `/events/ingest`

| Field | Value |
|-------|-------|
| **URL** | `$EVENT_HUB_URL` (default: `http://192.168.21.47:8000/events/ingest`) |
| **Method** | `POST` |
| **Headers** | `accept: application/json`, `Content-Type: application/json` |
| **Timeout** | 5 seconds |

**Request body:**
```json
{
  "source": "card_reader_01",
  "type": "card_reader",
  "priority": "high",
  "payload": {
    "card_id": "DB8A4806",
    "person_id": "EMP001",
    "person_name": "Nguyen Van A",
    "action": "entry",
    "location": "main_entrance",
    "reader_id": "CR-001",
    "access": true,
    "message": "Quet the thanh cong"
  }
}
```

**ACK response (success):**
```json
{"status": "ok", "event_id": "<uuid>", "topic": "security", "queued": true}
```

**Error response (client-side):**
```json
{"status": "error", "detail": "<reason or connection_failed>"}
```

**Barrier rule:** open ONLY when `access == true` AND `result["status"] == "ok"`.

**Message rule:**
- `access=true` → `"Quet the thanh cong"`
- `access=false` → `"The khong hop le"`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVENT_HUB_URL` | `http://192.168.21.47:8000/events/ingest` | Upstream ingest endpoint |
| `READER_ID` | `CR-001` | Reader device identifier |
| `LOCATION` | `main_entrance` | Physical location tag |
| `LOG_LEVEL` | `INFO` | Python logging level |

---

## External Systems

| System | URL | Protocol |
|--------|-----|----------|
| Event Hub REST | `http://192.168.21.47:8000` | HTTP/REST |
| Event Hub WS | `ws://192.168.23.46:8000` | WebSocket (phase 2) |

### Event Hub Endpoints Used
- `POST /events/ingest` — send card event
- `GET /health` — health check (phase 2)

---

## Thread / Concurrency Model

```
[uvicorn main thread — asyncio event loop]
    ├── broadcast_worker()  — asyncio.Task, consumes queue → history + WS fan-out
    ├── ping_clients()      — asyncio.Task, 30 s keepalive
    └── [daemon thread] reader_loop(queue, loop, app_state)
            └── PN532Reader.read_uid() → normalize → lookup → send_card_event()
                └── loop.call_soon_threadsafe(queue.put_nowait, event)
```

**Key invariants:**
- `queue.put_nowait` called only via `loop.call_soon_threadsafe` from reader thread
- `app_state["total_scans"]` mutated only under `app_state["lock"]` (threading.Lock)
- `history` and `connected_clients` mutated only from asyncio event loop

---

## Dependencies (`.venv` / `requirements.txt`)

| Package | Purpose |
|---------|---------|
| `fastapi>=0.110.0` | Web framework |
| `uvicorn[standard]>=0.29.0` | ASGI server |
| `websockets>=12.0` | WebSocket support |
| `adafruit-circuitpython-pn532` | PN532 SPI driver |
| `requests>=2.31.0` | HTTP client for Event Hub |

---

## Card Registry (v1.0)

| card_id | person_id | person_name | access |
|---------|-----------|-------------|--------|
| `A66AB0AA` | `EMP001` | Nguyen Van A | `true` |
| `AABBCCDD` | `EMP002` | Tran Thi B | `true` |
| *(unknown)* | `None` | Unknown | `false` |

---

## Hardware Pin Map (SPI)

| Signal | Pi 5 Pin | Board Constant |
|--------|----------|----------------|
| CS | GPIO 5 | `board.D5` |
| SCK | GPIO 11 | `board.SCK` |
| MOSI | GPIO 10 | `board.MOSI` |
| MISO | GPIO 9 | `board.MISO` |
