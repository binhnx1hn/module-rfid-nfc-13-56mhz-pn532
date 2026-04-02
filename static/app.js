/**
 * PN532 Dashboard — app.js
 * Vanilla JS, no frameworks, no external CDN
 * WebSocket: ws://{host}/ws/dashboard — auto-reconnect 3s
 * Status poll: /api/status every 10s
 */

/* ============================================================
   Utility helpers
   ============================================================ */

/**
 * Format ISO timestamp → "HH:MM:SS DD/MM/YYYY" in local time
 * @param {string} iso
 * @returns {string}
 */
function formatTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour12: false,
  });
  const p = fmt.formatToParts(d).reduce((acc, { type, value }) => { acc[type] = value; return acc; }, {});
  return `${p.hour}:${p.minute}:${p.second} ${p.day}/${p.month}/${p.year}`;
}

/**
 * Format seconds → "Xh Ym Zs"
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Create an access badge element
 * @param {boolean} access
 * @returns {HTMLElement}
 */
function makeAccessBadge(access) {
  const el = document.createElement('span');
  el.className = `badge ${access ? 'badge-ok' : 'badge-error'}`;
  el.textContent = access ? 'ALLOWED' : 'DENIED';
  return el;
}

/**
 * Create a hub status badge element
 * @param {string} hubStatus  "ok" | "error" | "unknown"
 * @returns {HTMLElement}
 */
function makeHubBadge(hubStatus) {
  const el = document.createElement('span');
  if (hubStatus === 'error') {
    // Hide hub error badge everywhere in UI.
    el.style.display = 'none';
    return el;
  }
  const map = {
    ok:      ['badge-ok',    'Hub: OK'],
    unknown: ['badge-gray',  'Hub: ?'],
  };
  const [cls, label] = map[hubStatus] || map.unknown;
  el.className = `badge ${cls}`;
  el.textContent = label;
  return el;
}

/* ============================================================
   Badge updaters (Header)
   ============================================================ */

const elReaderBadge = document.getElementById('badge-reader');
const elHubBadge    = document.getElementById('badge-hub');
const elWsBadge     = document.getElementById('badge-ws');
const elScans       = document.getElementById('badge-scans');
const elUptime      = document.getElementById('badge-uptime');

function setReaderBadge(status) {
  const map = {
    ok:           ['badge-ok',    'Reader: OK'],
    error:        ['badge-error', 'Reader: ERROR'],
    initializing: ['badge-warn',  'Reader: INITIALIZING'],
  };
  const [cls, label] = map[status] || ['badge-gray', `Reader: ${status}`];
  elReaderBadge.className = `badge ${cls}`;
  elReaderBadge.textContent = label;
}

function setHubHeaderBadge(status) {
  // Hide the whole Hub badge section when hub is offline/error.
  // In index.html there is a separate label element right before #badge-hub.
  const labelEl = elHubBadge?.previousElementSibling || null;
  if (status === 'error') {
    if (labelEl && labelEl.classList && labelEl.classList.contains('badge-label')) {
      labelEl.style.display = 'none';
    }
    elHubBadge.style.display = 'none';
    return;
  }

  // Ensure visible for other states.
  if (labelEl && labelEl.classList && labelEl.classList.contains('badge-label')) {
    labelEl.style.display = '';
  }
  elHubBadge.style.display = '';

  const map = {
    ok:      ['badge-ok',    'Hub: ONLINE'],
    unknown: ['badge-gray',  'Hub: UNKNOWN'],
  };
  const [cls, label] = map[status] || ['badge-gray', `Hub: ${status}`];
  elHubBadge.className = `badge ${cls}`;
  elHubBadge.textContent = label;
}

function setWsBadge(state) {
  // state: 'connected' | 'reconnecting' | 'error'
  if (state === 'connected') {
    elWsBadge.className = 'badge badge-ok';
    elWsBadge.textContent = 'WS: Connected';
    const wsText = document.getElementById('ws-status-text');
    if (wsText) wsText.textContent = 'Connected';
  } else if (state === 'reconnecting') {
    elWsBadge.className = 'badge badge-warn blink';
    elWsBadge.textContent = 'WS: Reconnecting...';
    const wsText = document.getElementById('ws-status-text');
    if (wsText) wsText.textContent = 'Reconnecting...';
  } else {
    elWsBadge.className = 'badge badge-error';
    elWsBadge.textContent = 'WS: Error';
  }
}

/* ============================================================
   Live Scan Log
   ============================================================ */

const MAX_LIVE_ENTRIES = 20;
const elLiveLog   = document.getElementById('live-log');
const elLiveEmpty = document.getElementById('live-empty');

/**
 * Prepend a scan entry to the live log
 * @param {object} event  WebSocket event frame
 */
function prependLiveEntry(event) {
  // Hide empty placeholder
  if (elLiveEmpty) elLiveEmpty.style.display = 'none';

  const entry = document.createElement('div');
  entry.className = `scan-entry ${event.access ? 'allowed' : 'denied'} flash`;

  // Header row: time | badges
  const header = document.createElement('div');
  header.className = 'scan-entry-header';

  const timeEl = document.createElement('span');
  timeEl.className = 'scan-time';
  timeEl.textContent = formatTimestamp(event.timestamp);

  const badgesEl = document.createElement('div');
  badgesEl.className = 'scan-badges';
  badgesEl.appendChild(makeAccessBadge(event.access));
  badgesEl.appendChild(makeHubBadge(event.hub_status));

  header.appendChild(timeEl);
  header.appendChild(badgesEl);

  // Name row
  const nameEl = document.createElement('div');
  nameEl.className = 'scan-name';
  nameEl.textContent = event.person_name || 'Unknown';

  // Card ID row
  const cardEl = document.createElement('div');
  cardEl.className = 'scan-card-id';
  cardEl.textContent = `Card: ${event.card_id}`;

  entry.appendChild(header);
  entry.appendChild(nameEl);
  entry.appendChild(cardEl);

  // Prepend to log
  elLiveLog.insertBefore(entry, elLiveLog.firstChild);

  // Remove flash class after 1s
  setTimeout(() => entry.classList.remove('flash'), 1000);

  // Trim to max entries
  const entries = elLiveLog.querySelectorAll('.scan-entry');
  if (entries.length > MAX_LIVE_ENTRIES) {
    for (let i = MAX_LIVE_ENTRIES; i < entries.length; i++) {
      entries[i].remove();
    }
  }
}

/* ============================================================
   Access History Table
   ============================================================ */

const MAX_HISTORY_ROWS = 100;
const elHistoryBody  = document.getElementById('history-body');
const elHistoryCount = document.getElementById('history-count');

/**
 * Render history table from an events array (newest first)
 * @param {Array} events
 */
function renderHistoryTable(events) {
  elHistoryBody.innerHTML = '';

  if (!events || events.length === 0) {
    elHistoryBody.innerHTML = '<tr><td colspan="6" class="empty-cell">No events yet</td></tr>';
    elHistoryCount.textContent = '0';
    return;
  }

  const frag = document.createDocumentFragment();
  const slice = events.slice(0, MAX_HISTORY_ROWS);

  slice.forEach((ev) => {
    frag.appendChild(buildHistoryRow(ev));
  });

  elHistoryBody.appendChild(frag);
  elHistoryCount.textContent = String(slice.length);
}

/**
 * Build a single <tr> for the history table
 * @param {object} ev
 * @returns {HTMLTableRowElement}
 */
function buildHistoryRow(ev) {
  const tr = document.createElement('tr');

  const tdTs = document.createElement('td');
  tdTs.className = 'ts-cell';
  tdTs.textContent = formatTimestamp(ev.timestamp);

  const tdCard = document.createElement('td');
  tdCard.className = 'card-id-cell';
  tdCard.textContent = ev.card_id;

  const tdPerson = document.createElement('td');
  tdPerson.textContent = ev.person_name || 'Unknown';

  const tdAccess = document.createElement('td');
  tdAccess.appendChild(makeAccessBadge(ev.access));

  const tdHub = document.createElement('td');
  tdHub.appendChild(makeHubBadge(ev.hub_status));

  const tdMsg = document.createElement('td');
  tdMsg.className = 'message-cell';
  tdMsg.title = ev.message || '';
  tdMsg.textContent = ev.message || '—';

  tr.appendChild(tdTs);
  tr.appendChild(tdCard);
  tr.appendChild(tdPerson);
  tr.appendChild(tdAccess);
  tr.appendChild(tdHub);
  tr.appendChild(tdMsg);

  return tr;
}

/**
 * Prepend a single event row to history (on WS event — no re-fetch)
 * @param {object} ev
 */
function prependHistoryRow(ev) {
  // Remove "No events yet" placeholder if present
  const empty = elHistoryBody.querySelector('.empty-cell');
  if (empty) elHistoryBody.innerHTML = '';

  const tr = buildHistoryRow(ev);
  elHistoryBody.insertBefore(tr, elHistoryBody.firstChild);

  // Trim to max rows
  const rows = elHistoryBody.querySelectorAll('tr');
  if (rows.length > MAX_HISTORY_ROWS) {
    for (let i = MAX_HISTORY_ROWS; i < rows.length; i++) {
      rows[i].remove();
    }
  }

  const current = parseInt(elHistoryCount.textContent, 10) || 0;
  elHistoryCount.textContent = String(Math.min(current + 1, MAX_HISTORY_ROWS));
}

/* ============================================================
   Card Registry Table
   ============================================================ */

const elRegistryBody = document.getElementById('registry-body');

/**
 * Render the card/user registry table
 * @param {Array} cards
 */
function renderRegistry(cards) {
  elRegistryBody.innerHTML = '';

  if (!cards || cards.length === 0) {
    elRegistryBody.innerHTML = '<tr><td colspan="4" class="empty-cell">No cards registered</td></tr>';
    return;
  }

  const frag = document.createDocumentFragment();
  cards.forEach((card) => {
    const tr = document.createElement('tr');

    const tdCard = document.createElement('td');
    tdCard.className = 'card-id-cell';
    tdCard.textContent = card.card_id;

    const tdName = document.createElement('td');
    tdName.textContent = card.person_name || '—';

    const tdPid = document.createElement('td');
    tdPid.className = 'person-id-cell';
    tdPid.textContent = card.person_id || '—';

    const tdAccess = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${card.access ? 'badge-ok' : 'badge-error'}`;
    badge.textContent = card.access ? 'ALLOWED' : 'BLOCKED';
    tdAccess.appendChild(badge);

    tr.appendChild(tdCard);
    tr.appendChild(tdName);
    tr.appendChild(tdPid);
    tr.appendChild(tdAccess);

    frag.appendChild(tr);
  });

  elRegistryBody.appendChild(frag);
}

/* ============================================================
   API fetchers
   ============================================================ */

async function fetchCards() {
  try {
    const res = await fetch('/api/cards');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderRegistry(data.cards || []);
  } catch (err) {
    elRegistryBody.innerHTML = '<tr><td colspan="4" class="empty-cell">Failed to load cards</td></tr>';
  }
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderHistoryTable(data.events || []);
  } catch (err) {
    elHistoryBody.innerHTML = '<tr><td colspan="6" class="empty-cell">Failed to load history</td></tr>';
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setReaderBadge(data.reader_status || 'initializing');
    setHubHeaderBadge(data.hub_status || 'unknown');
    elScans.textContent  = String(data.total_scans ?? 0);
    elUptime.textContent = formatUptime(data.uptime_seconds ?? 0);
  } catch (_err) {
    // Silently ignore — badges remain at last known state
  }
}

/* ============================================================
   WebSocket client — auto-reconnect
   ============================================================ */

let ws = null;
let wsReconnectTimer = null;
let isIntentionalClose = false;

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${window.location.host}/ws/dashboard`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    console.log('[WS] Connected to', url);
    isIntentionalClose = false;
    setWsBadge('connected');
    // Refresh history on (re)connect to sync any missed events
    fetchHistory();
  });

  ws.addEventListener('message', (evt) => {
    let frame;
    try {
      frame = JSON.parse(evt.data);
    } catch (_) {
      return;
    }

    // Ignore keepalive ping frames
    if (frame.type === 'ping') return;

    // Valid card event — update live log + history
    prependLiveEntry(frame);
    prependHistoryRow(frame);
  });

  ws.addEventListener('close', (evt) => {
    console.log('[WS] Disconnected — code:', evt.code);
    ws = null;
    if (!isIntentionalClose) {
      setWsBadge('reconnecting');
      wsReconnectTimer = setTimeout(connectWebSocket, 3000);
    }
  });

  ws.addEventListener('error', (err) => {
    console.error('[WS] Error:', err);
    // 'close' event fires automatically after error — reconnect handled there
  });
}

/* ============================================================
   Status polling — every 10 seconds
   ============================================================ */

let statusPollTimer = null;

function startStatusPoll() {
  fetchStatus(); // immediate first poll
  statusPollTimer = setInterval(fetchStatus, 10_000);
}

/* ============================================================
   Refresh button
   ============================================================ */

document.getElementById('btn-refresh-cards').addEventListener('click', () => {
  elRegistryBody.innerHTML = '<tr><td colspan="4" class="empty-cell">Loading...</td></tr>';
  fetchCards();
});

/* ============================================================
   Init on page load
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  fetchCards();
  fetchHistory();
  startStatusPoll();
  connectWebSocket();
});
