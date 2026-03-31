# Research — v2.0: Web UI Dashboard + Docker

**Classification:** FEATURE  
**Version:** v2.0  
**Date:** 2026-03-31  
**Analyst:** BA

---

## 1. Architecture Decision

### 1.1 Confirmed Architecture

The proposed architecture is **confirmed with one clarification** on the internal event flow.

```
┌──────────────────────────────────────────────────────────────┐
│                      Docker Container                        │
│                                                              │
│  /dev/spidev0.0 ──► pn532_reader.py (PN532Reader)           │
│                           │ uid_bytes                        │
│                           ▼                                  │
│                    card_registry.py (lookup_card)            │
│                           │ CardRecord                       │
│                           ▼                                  │
│                   event_hub_client.py ──────────────────────►│ Event Hub
│                           │ result dict                      │  REST API
│                           ▼                                  │
│              asyncio.Queue (thread-safe bridge)              │
│                           │ CardEvent dict                   │
│                           ▼                                  │
│                     app.py (FastAPI / uvicorn)               │
│                     ├── GET  /                               │
│                     ├── GET  /api/history                    │
│                     ├── GET  /api/cards                      │
│                     ├── GET  /api/status                     │
│                     └── WS  /ws/dashboard                    │
│                           │                                  │
│                           ▼                                  │
│               Browser (HTML + vanilla JS + CSS)              │
│               ├── Live scan log (WebSocket)                  │
│               ├── Card/user list table                       │
│               └── Access history table                       │
└──────────────────────────────────────────────────────────────┘
```

**Key clarification:** `main.py` is refactored to run the PN532 polling loop inside a **daemon thread** via `threading.Thread`. FastAPI/uvicorn owns the main async event loop. A single `asyncio.Queue` instance bridges the two execution contexts safely.

### 1.2 Rejected Alternative: asyncio-only

Running `pn532_reader.read_uid()` inside `asyncio.to_thread()` or `loop.run_in_executor()` was considered. **Rejected** because:
- The SPI `read_passive_target(timeout=0.5)` call is a blocking C-extension call that holds the GIL during hardware polling
- Wrapping it in an executor still works, but re-creating a thread per poll cycle creates unnecessary overhead
- A dedicated daemon thread with `asyncio.Queue.put_nowait()` is simpler and more reliable for embedded use

### 1.3 main.py Refactor Strategy

`main.py` becomes `reader_thread.py` (or keeps the name `main.py`) and is restructured:

```
reader_loop(queue: asyncio.Queue)    ← runs in daemon thread
    while True:
        uid_bytes = reader.read_uid()  ← blocking SPI poll
        if uid_bytes:
            card_id = normalize_uid(uid_bytes)
            user = lookup_card(card_id)
            result = send_card_event(...)  ← blocking HTTP
            event = build_card_event(card_id, user, result)
            queue.put_nowait(event)        ← non-blocking, thread-safe

app startup (FastAPI lifespan):
    queue = asyncio.Queue()
    thread = threading.Thread(target=reader_loop, args=(queue,), daemon=True)
    thread.start()

broadcast_worker(queue):    ← asyncio.Task, runs in event loop
    while True:
        event = await queue.get()
        history.appendleft(event)     ← deque maxlen=100
        for ws in connected_clients:
            await ws.send_json(event)
```

**Note on `asyncio.Queue` thread-safety:** `queue.put_nowait()` from a non-async thread requires calling `loop.call_soon_threadsafe(queue.put_nowait, event)` to be safe. BE Dev must use this pattern.

---

## 2. API Contracts

### 2.1 `GET /`

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/` |
| Auth | None |
| Response | `text/html` — serves `static/index.html` |
| Error | `500` if static file missing |

**Purpose:** Serve the dashboard single-page HTML file.

---

### 2.2 `GET /api/history`

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/history` |
| Auth | None |
| Query Params | None |
| Response Content-Type | `application/json` |

**Success Response `200`:**
```json
{
  "count": 3,
  "events": [
    {
      "timestamp": "2026-03-31T10:05:00",
      "card_id": "A66AB0AA",
      "person_name": "Nguyen Van A",
      "person_id": "EMP001",
      "access": true,
      "hub_status": "ok",
      "message": "Quet the thanh cong"
    },
    {
      "timestamp": "2026-03-31T10:03:22",
      "card_id": "DEADBEEF",
      "person_name": "Unknown",
      "person_id": null,
      "access": false,
      "hub_status": "error",
      "message": "The khong hop le"
    }
  ]
}
```

**Notes:**
- `events` is ordered newest-first (index 0 = most recent)
- Maximum 100 events (deque maxlen=100)
- In-memory only — cleared on container restart
- `hub_status`: `"ok"` | `"error"` | `"unknown"` (unknown = reader thread not yet started)

---

### 2.3 `GET /api/cards`

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/cards` |
| Auth | None |
| Response Content-Type | `application/json` |

**Success Response `200`:**
```json
{
  "count": 2,
  "cards": [
    {
      "card_id": "A66AB0AA",
      "person_id": "EMP001",
      "person_name": "Nguyen Van A",
      "access": true
    },
    {
      "card_id": "AABBCCDD",
      "person_id": "EMP002",
      "person_name": "Tran Thi B",
      "access": true
    }
  ]
}
```

**Notes:**
- Data sourced directly from `CARD_DB` in [`card_registry.py`](../card_registry.py)
- Read-only in v2.0 (editing deferred to v2.1)
- `card_id` key is included in response (not stored in `CARD_DB` values — must be injected from `CARD_DB` key)

---

### 2.4 `GET /api/status`

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/status` |
| Auth | None |
| Response Content-Type | `application/json` |

**Success Response `200`:**
```json
{
  "reader_status": "ok",
  "hub_status": "ok",
  "hub_url": "http://192.168.21.47:8000",
  "total_scans": 42,
  "uptime_seconds": 3600,
  "version": "2.0.0"
}
```

**Field definitions:**
| Field | Type | Values | Source |
|-------|------|--------|--------|
| `reader_status` | string | `"ok"` \| `"error"` \| `"initializing"` | Set by reader thread — `"ok"` after first successful `firmware_version` read |
| `hub_status` | string | `"ok"` \| `"error"` \| `"unknown"` | Last Hub response status from history deque |
| `hub_url` | string | URL | From `EVENT_HUB_URL` env var |
| `total_scans` | int | ≥0 | Running counter in app state |
| `uptime_seconds` | int | ≥0 | `time.time() - app_start_time` |
| `version` | string | semver | Hardcoded `"2.0.0"` |

**Hub status derivation rule:** Check last event in history deque. If `hub_status == "ok"` → online. If `"error"` → offline. If deque empty → `"unknown"`.

---

### 2.5 `WS /ws/dashboard`

| Field | Value |
|-------|-------|
| Protocol | WebSocket |
| Path | `/ws/dashboard` |
| Auth | None |
| Direction | Server → Client (broadcast only) |

**On connect:** Server sends the last 10 events from history as individual JSON frames (replay), then streams new events as they arrive.

**Event frame (JSON):**
```json
{
  "timestamp": "2026-03-31T10:00:00",
  "card_id": "A66AB0AA",
  "person_name": "Nguyen Van A",
  "person_id": "EMP001",
  "access": true,
  "hub_status": "ok",
  "message": "Quet the thanh cong"
}
```

**Field definitions:**
| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | ISO 8601 string | `datetime.utcnow().isoformat()` — no timezone suffix for simplicity |
| `card_id` | string | Uppercase hex, e.g. `"A66AB0AA"` |
| `person_name` | string | From `lookup_card()` — `"Unknown"` for unregistered cards |
| `person_id` | string \| null | `null` for unknown cards (OBS-01 fix: `Optional[str]`) |
| `access` | bool | `true` = ALLOWED, `false` = DENIED |
| `hub_status` | string | `"ok"` \| `"error"` |
| `message` | string | `"Quet the thanh cong"` \| `"The khong hop le"` |

**Keepalive:** Server sends `{"type": "ping"}` every 30 seconds to detect dead connections. Client ignores ping frames (no pong required for browser WebSocket).

**Disconnect handling:** Server removes the WebSocket from `connected_clients` set on disconnect/exception. Client-side JS must implement auto-reconnect with 3-second delay.

---

## 3. Docker Spec

### 3.1 Base Image

| Decision | Value | Rationale |
|----------|-------|-----------|
| Base image | `python:3.11-slim-bookworm` | ARM64-compatible (multi-arch manifest), Debian Bookworm, smaller than bullseye-full, has required SPI kernel modules available at host level |
| Platform | `linux/arm64` | Pi 5 is ARM Cortex-A76 (aarch64) |
| Alternative considered | `python:3.11-bullseye` | Larger (~200MB more); not needed |

### 3.2 Dockerfile

```dockerfile
FROM python:3.11-slim-bookworm
WORKDIR /app

# Install system deps for SPI/CircuitPython
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgpiod2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

### 3.3 docker-compose.yml

```yaml
version: "3.9"
services:
  card-reader:
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"
    devices:
      - /dev/spidev0.0:/dev/spidev0.0
      - /dev/spidev0.1:/dev/spidev0.1
    group_add:
      - "spi"
    environment:
      - EVENT_HUB_URL=${EVENT_HUB_URL:-http://192.168.21.47:8000/events/ingest}
      - READER_ID=${READER_ID:-CR-001}
      - LOCATION=${LOCATION:-main_entrance}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}
    volumes:
      - /dev/gpiomem:/dev/gpiomem
```

**SPI passthrough rationale:**
- `devices:` passes `/dev/spidev0.0` into container without `privileged: true`
- `group_add: spi` adds container process to the `spi` group (GID varies by Pi OS — use `getent group spi` on host to verify)
- `/dev/gpiomem` volume needed for CircuitPython `board.*` pin references
- Do **not** use `privileged: true` — unnecessarily grants full host access

### 3.4 Environment Variables

| Var | Default | Required | Description |
|-----|---------|----------|-------------|
| `EVENT_HUB_URL` | `http://192.168.21.47:8000/events/ingest` | No | Full URL for Event Hub ingest endpoint |
| `READER_ID` | `CR-001` | No | Reader device identifier in event payload |
| `LOCATION` | `main_entrance` | No | Physical location identifier in event payload |
| `LOG_LEVEL` | `INFO` | No | Python logging level: `DEBUG`\|`INFO`\|`WARNING`\|`ERROR` |

**Migration from v1.0 hardcodes:**
- [`event_hub_client.py:10`](../event_hub_client.py) `EVENT_HUB_URL` hardcode → replace with `os.getenv("EVENT_HUB_URL", "http://192.168.21.47:8000/events/ingest")` (addresses Reviewer ARCH-04)
- [`event_hub_client.py:25`](../event_hub_client.py) `reader_id` default → replace with `os.getenv("READER_ID", "CR-001")`
- [`event_hub_client.py:26`](../event_hub_client.py) `location` default → replace with `os.getenv("LOCATION", "main_entrance")`

### 3.5 requirements.txt (new)

```
fastapi>=0.110.0
uvicorn[standard]>=0.29.0
websockets>=12.0
adafruit-circuitpython-pn532
requests>=2.31.0
```

---

## 4. Threading / Concurrency Model

### 4.1 Execution Contexts

| Context | Mechanism | Runs | Responsibilities |
|---------|-----------|------|-----------------|
| Main event loop | `asyncio` (uvicorn) | All FastAPI routes, WebSocket handlers, broadcast worker | HTTP request handling, WS send, history read |
| Reader thread | `threading.Thread(daemon=True)` | Blocking SPI poll + blocking HTTP POST | PN532 read, card lookup, event hub call, event push |

### 4.2 Data Flow Diagram

```
Reader Thread                    Event Loop (asyncio)
─────────────                    ───────────────────
PN532Reader.read_uid()           FastAPI routes
    │                                │
    ▼                                ▼
normalize_uid()              GET /api/history ──► history deque (read)
    │                        GET /api/cards   ──► CARD_DB (read)
    ▼                        GET /api/status  ──► app_state (read)
lookup_card()
    │
    ▼
send_card_event()   ──────► Event Hub REST
    │ result
    ▼
build_event_dict()
    │
    ▼ loop.call_soon_threadsafe(queue.put_nowait, event)
    │
    └──────────────────────► asyncio.Queue
                                  │
                                  ▼ (broadcast_worker coroutine)
                             history.appendleft(event)
                                  │
                                  ▼
                             for ws in connected_clients:
                                  await ws.send_json(event)
```

### 4.3 Shared State (Thread Safety Rules)

| Object | Type | Written by | Read by | Safety mechanism |
|--------|------|-----------|---------|-----------------|
| `queue` | `asyncio.Queue` | Reader thread (via `loop.call_soon_threadsafe`) | Event loop broadcast worker | `call_soon_threadsafe` guarantees safe cross-thread enqueue |
| `history` | `collections.deque(maxlen=100)` | Event loop broadcast worker only | Event loop HTTP handlers only | Single-writer single-reader in event loop — no lock needed |
| `connected_clients` | `set[WebSocket]` | Event loop (WS connect/disconnect) | Event loop broadcast worker | Accessed only from event loop — no lock needed |
| `app_state` | `dict` (reader_status, total_scans, start_time) | Reader thread (status) + event loop (scan count) | Event loop HTTP handlers | `reader_status` uses `threading.Event` flag; `total_scans` uses `threading.Lock` |
| `CARD_DB` | `dict` | Never written after init | Event loop HTTP handlers | Read-only — no lock needed |

### 4.4 PN532 Init Failure Handling

If `PN532Reader.__init__()` raises (hardware not present, SPI not available):
- Reader thread catches exception, sets `app_state["reader_status"] = "error"`
- Thread exits cleanly — does **not** crash the FastAPI process
- Web UI continues to serve `/api/status` with `reader_status: "error"`
- Dashboard shows "Reader offline" banner

---

## 5. Failure Modes & Constraints

### 5.1 Failure Mode Table

| Failure | Trigger | Impact | Handling |
|---------|---------|--------|----------|
| PN532 not connected (SPI init fail) | `PN532_SPI()` raises `RuntimeError` | Reader thread dies | Catch in thread, set `reader_status="error"`, web continues |
| SPI device not in container | `/dev/spidev0.0` missing | Same as above | Docker `devices:` config issue — document in README |
| Event Hub offline | `ConnectionError` in `send_card_event()` | `hub_status="error"` in event | Already handled in v1.0 — event still broadcast to dashboard |
| Event Hub timeout (>5s) | `requests.Timeout` | `hub_status="error"` | Already handled in v1.0 |
| WebSocket client disconnects | Browser close/network drop | `WebSocketDisconnect` exception | Remove from `connected_clients`, no crash |
| Multiple WS clients | N concurrent browsers | Broadcast to all | `connected_clients` set supports N clients |
| History overflow | >100 events | Oldest dropped | `deque(maxlen=100)` auto-evicts |
| Container OOM | Unlikely at this scale | Process kill → restart | `restart: unless-stopped` in compose |

### 5.2 Dashboard Behavior on Failures

| State | Dashboard Shows |
|-------|----------------|
| Reader offline | Red "Reader Offline" status badge; history still accessible |
| Hub offline | Orange "Hub Offline" badge; events show `hub_status: error` in red |
| WebSocket disconnected | JS auto-reconnect every 3s; "Reconnecting..." spinner shown |
| No cards scanned yet | Empty history table with "No events yet" placeholder |

### 5.3 Constraints

- **No authentication** — dashboard accessible to anyone on LAN (v2.1 scope)
- **No persistence** — history lost on restart (v2.1 scope for SQLite)
- **No hot-reload of CARD_DB** — requires container restart to add cards (v2.1 scope)
- **Single reader** — one PN532 per container (v2.1 scope for multi-reader)
- **DEBOUNCE_SECONDS = 10.0** in [`pn532_reader.py:14`](../pn532_reader.py) — unchanged from v1.0

---

## 6. Scope v2.0

### IN SCOPE

| Item | Owner | Notes |
|------|-------|-------|
| [`app.py`](../app.py) — FastAPI app with 4 REST endpoints + 1 WS | BE Dev | New file |
| [`main.py`](../main.py) refactor — `reader_loop()` as daemon thread | BE Dev | Minimal diff from v1.0 |
| [`static/index.html`](../static/index.html) — dashboard HTML | FE Dev | New file |
| [`static/style.css`](../static/style.css) — dashboard CSS | FE Dev | New file |
| [`static/app.js`](../static/app.js) — WebSocket client JS | FE Dev | New file |
| [`Dockerfile`](../Dockerfile) — ARM64 container build | BE Dev | New file |
| [`docker-compose.yml`](../docker-compose.yml) — compose with SPI passthrough | BE Dev | New file |
| [`requirements.txt`](../requirements.txt) — pinned Python deps | BE Dev | New file |
| Env-var migration of `EVENT_HUB_URL`, `READER_ID`, `LOCATION` | BE Dev | Addresses ARCH-04 from Reviewer |
| `logging` module replacing `print()` | BE Dev | Addresses OBS-03 from QC |
| `Optional[str]` fix for `CardRecord.person_id` | BE Dev | Addresses OBS-01 from QC |

### OUT OF SCOPE (v2.1+)

| Item | Reason |
|------|--------|
| Edit card/user via UI | Requires auth + DB — v2.1 |
| Authentication / login | v2.1 |
| SQLite history persistence | v2.1 |
| GPIO relay control via UI | v2.1 |
| Multiple readers | v2.1 |
| CARD_DB hot-reload | v2.1 |
| WebSocket Hub integration (`ws://192.168.23.46:8000`) | Already in codemap as phase 2 — v2.1 |

---

## 7. Open Questions (Resolved)

| # | Question | Decision |
|---|----------|----------|
| Q1 | `asyncio.Queue` vs `queue.Queue` for thread bridge? | `asyncio.Queue` + `loop.call_soon_threadsafe()` — keeps broadcast worker as simple async coroutine |
| Q2 | `privileged: true` in Docker? | **No** — use `devices:` + `group_add: spi` for least-privilege SPI access |
| Q3 | Serve static files via FastAPI `StaticFiles` or inline HTML? | `StaticFiles` mount — cleaner separation, supports CSS/JS as separate files |
| Q4 | WebSocket replay on connect? | Yes — send last 10 events from history on new connection to avoid blank dashboard on page refresh |
| Q5 | Pi 5 ARM64 Docker base image? | `python:3.11-slim-bookworm` — officially supports `linux/arm64` multi-arch |
