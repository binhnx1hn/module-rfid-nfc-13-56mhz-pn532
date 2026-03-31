# PN532 Card Reader — NFC/RFID Access Control

Raspberry Pi 5 + PN532 (SPI) → NFC card reader → Event Hub integration  
Web dashboard + Admin panel chạy trong Docker.

## Quick Start

### Yêu cầu
- Raspberry Pi 5 với PN532 kết nối SPI (CS=D5)
- Docker + Docker Compose đã cài

### Chạy
```bash
docker compose up --build
```

Mở browser: `http://<Pi-IP>:8080`

### Cấu hình
Tạo file `.env` (tùy chọn):
```env
EVENT_HUB_URL=http://192.168.21.47:8000/events/ingest
READER_ID=CR-001
LOCATION=main_entrance
LOG_LEVEL=INFO
```

## Tính năng
- **Dashboard** (`/`): Live scan log realtime qua WebSocket
- **Admin** (`/admin`): Thêm/sửa/xóa thẻ và người dùng
- **REST API**: `/api/status`, `/api/history`, `/api/cards`

## Cấu trúc
```
pn532_reader.py      # SPI hardware layer
card_registry.py     # Card UID → user map (JSON-backed)
event_hub_client.py  # REST POST to Event Hub
main.py              # Reader loop (daemon thread)
app.py               # FastAPI web server
static/              # Web dashboard + admin UI
data/cards.json      # Card database
```

## Event Hub payload
```json
{
  "source": "card_reader_01",
  "type": "card_reader",
  "priority": "high",
  "payload": {
    "card_id": "A66AB0AA",
    "person_id": "EMP001",
    "person_name": "Nguyen Van A",
    "action": "entry",
    "access": true
  }
}
```
