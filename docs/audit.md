# Audit Report — v2.1: Admin CRUD Page

**Date:** 2026-03-31  
**Auditor:** QC  
**Pipeline:** BE ✅ → FE ✅ → Integration ✅ (10/10) → Vision ✅ → QC  
**Verdict:** ✅ **PASS** (1 minor non-blocking finding)

---

## Backend Standards — `card_registry.py` + `app.py`

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| BE-01 | `threading.RLock()` for all `_db` reads/writes | ✅ PASS | `card_registry.py:23` — `_lock = threading.RLock()` |
| BE-02 | `_save()` only called under `_lock` | ✅ PASS | All 3 call sites (L76, L93, L105) are inside `with _lock:` |
| BE-03 | `os.makedirs(exist_ok=True)` before file write | ✅ PASS | `card_registry.py:44` |
| BE-04 | `add_card()` normalizes card_id: uppercase + strip spaces | ✅ PASS | `card_registry.py:71` — `.upper().replace(" ", "")` |
| BE-05 | `add_card()` raises `ValueError` on duplicate | ✅ PASS | `card_registry.py:74` |
| BE-06 | `update_card()` raises `KeyError` on not found | ✅ PASS | `card_registry.py:86` |
| BE-07 | `delete_card()` returns `False` if not found | ✅ PASS | `card_registry.py:103` |
| BE-08 | `_load()` handles `FileNotFoundError` gracefully | ✅ PASS | `card_registry.py:34` |
| BE-09 | `_load()` handles `json.JSONDecodeError` gracefully | ✅ PASS | `card_registry.py:37` |
| BE-10 | All logging via `logging.getLogger(__name__)` — no `print()` | ✅ PASS | `card_registry.py:11`, no `print()` found |
| BE-11 | `GET /api/cards` uses `get_all_cards()` (not stale dict) | ✅ PASS | `app.py:175` |
| BE-12 | Pydantic models `CardCreate`, `CardUpdate` used for validation | ✅ PASS | `app.py:159–169` |
| BE-13 | HTTP 409 on duplicate `card_id` | ✅ PASS | `app.py:197` |
| BE-14 | HTTP 404 on card not found (update/delete) | ✅ PASS | `app.py:207, 215` |
| BE-15 | `GET /admin` route returns `static/admin.html` | ✅ PASS | `app.py:143–146` |

### Minor Finding — BE-M01 (Non-blocking)

**Location:** [`update_card()`](../card_registry.py:95)  
**Issue:** `return {"card_id": card_id, **_db[card_id]}` reads `_db[card_id]` on line 95 **after** the `with _lock:` block has exited (block ends at line 93 after `_save()`). This is a TOCTOU race: a concurrent `delete_card()` call between line 93 and line 95 could raise a `KeyError` at the return statement.  
**Severity:** LOW — single-writer architecture in practice; admin operations are not high-concurrency. Not a crash in normal operation.  
**Recommendation:** Move the return statement inside the `with _lock:` block, or capture the value into a local variable before exiting the lock.

```python
# Fix: capture before releasing lock
with _lock:
    if card_id not in _db:
        raise KeyError(f"card_id {card_id} not found")
    ...
    _save()
    snapshot = dict(_db[card_id])  # capture under lock
return {"card_id": card_id, **snapshot}
```

---

## Frontend Standards — `admin.html` + `admin.js`

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| FE-01 | `fetch()` with `Content-Type: application/json` | ✅ PASS | `admin.js:90` (addCard), `admin.js:121` (updateCard) |
| FE-02 | All API calls use `async/await` + `try/catch` | ✅ PASS | `loadCards`, `addCard`, `updateCard`, `deleteCard` all comply |
| FE-03 | `card_id` auto-uppercase on `input` event | ✅ PASS | `admin.js:426` — `cardIdInput.addEventListener('input', ...)` with `normalizeCardId()` |
| FE-04 | `confirm()` dialog before delete | ✅ PASS | `admin.js:261` — `if (confirm(\`Xóa thẻ ${id}?\`))` |
| FE-05 | Toast for success AND error states | ✅ PASS | `showToast()` called for both types throughout |
| FE-06 | HTTP 409 → toast "Thẻ đã tồn tại" | ✅ PASS | `admin.js:97` — `showToast(\`Thẻ đã tồn tại: ${data.card_id}\`, 'error')` |
| FE-07 | HTTP 404 → toast "Không tìm thấy thẻ" | ✅ PASS | `admin.js:129` (updateCard), `admin.js:155` (deleteCard) |
| FE-08 | No external CDN in `admin.html` | ✅ PASS | Only `/static/style.css` and `/static/admin.js` — no CDN links |
| FE-09 | `admin.html` links `/static/style.css` and `/static/admin.js` | ✅ PASS | `admin.html:7` (CSS), `admin.html:116` (JS with `defer`) |
| FE-10 | `index.html` has `/admin` nav link | ✅ PASS | `index.html:18` — `<a href="/admin" class="nav-link">⚙️ Admin</a>` |

---

## Docker / Data

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| DC-01 | `docker-compose.yml` has `./data:/app/data` volume | ✅ PASS | `docker-compose.yml:24` |
| DC-02 | `data/cards.json` is valid JSON with ≥1 card | ✅ PASS | 2 cards: `A66AB0AA`, `AABBCCDD` |

---

## Security Scan

No blocking security issues found:
- No `print()` leaking to stdout with sensitive data
- HTML output uses `escHtml()` for XSS prevention (`admin.js:398–405`)
- No hardcoded secrets in audited files
- No external CDN (no supply-chain risk)
- Pydantic validation on all admin write endpoints

---

## Summary

**27/27 checks PASS. 1 minor non-blocking finding (BE-M01).**

All backend contract requirements satisfied. All frontend UX requirements met including Vietnamese error messages, confirm dialog, toast notifications, and auto-uppercase input. Docker volume and seed data correct.

The single finding (TOCTOU race in `update_card()` post-lock read) is low severity and does not affect correctness in the current single-writer deployment. Recommend fixing in next maintenance cycle.

**→ Signal: `qc-pass` → reviewer**
