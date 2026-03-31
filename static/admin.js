/**
 * admin.js — PN532 Admin Card Management v2.1
 * Vanilla JS, no framework, no CDN.
 * Handles CRUD for /api/admin/cards
 */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Array<{card_id: string, person_id: string, person_name: string, access: boolean}>} */
let cardsState = [];

// ---------------------------------------------------------------------------
// Utility: normalize card_id to uppercase hex only
// ---------------------------------------------------------------------------

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeCardId(raw) {
  return raw.toUpperCase().replace(/[^0-9A-F]/g, '');
}

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------

/**
 * @param {string} msg
 * @param {'success'|'error'} type
 */
function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  // Trigger CSS transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/cards → render table
 */
async function loadCards() {
  const btn = document.getElementById('btn-refresh');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/admin/cards', {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cardsState = data.cards || [];
    renderTable(cardsState);
    updateCardCount(cardsState.length);
  } catch (err) {
    showToast('Lỗi kết nối: không thể tải danh sách thẻ', 'error');
    console.error('[loadCards]', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * POST /api/admin/cards
 * @param {{card_id: string, person_id: string, person_name: string, access: boolean}} data
 */
async function addCard(data) {
  try {
    const res = await fetch('/api/admin/cards', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (res.status === 409) {
      showToast(`Thẻ đã tồn tại: ${data.card_id}`, 'error');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const result = await res.json();
    showToast(`Đã thêm thẻ ${result.card.card_id} thành công`, 'success');
    await loadCards();
    resetAddForm();
  } catch (err) {
    showToast('Lỗi kết nối: không thể thêm thẻ', 'error');
    console.error('[addCard]', err);
  }
}

/**
 * PUT /api/admin/cards/{card_id}
 * @param {string} cardId
 * @param {{person_id?: string, person_name?: string, access?: boolean}} data
 */
async function updateCard(cardId, data) {
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(cardId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (res.status === 404) {
      showToast(`Không tìm thấy thẻ: ${cardId}`, 'error');
      return false;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const result = await res.json();
    showToast(`Đã cập nhật thẻ ${result.card.card_id}`, 'success');
    return true;
  } catch (err) {
    showToast('Lỗi kết nối: không thể cập nhật thẻ', 'error');
    console.error('[updateCard]', err);
    return false;
  }
}

/**
 * DELETE /api/admin/cards/{card_id}
 * @param {string} cardId
 */
async function deleteCard(cardId) {
  try {
    const res = await fetch(`/api/admin/cards/${encodeURIComponent(cardId)}`, {
      method: 'DELETE',
      headers: { 'Accept': 'application/json' },
    });

    if (res.status === 404) {
      showToast(`Không tìm thấy thẻ: ${cardId}`, 'error');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    showToast(`Đã xóa thẻ ${cardId}`, 'success');
    await loadCards();
  } catch (err) {
    showToast('Lỗi kết nối: không thể xóa thẻ', 'error');
    console.error('[deleteCard]', err);
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * @param {number} count
 */
function updateCardCount(count) {
  const badge = document.getElementById('card-count-badge');
  if (badge) badge.textContent = `${count} thẻ`;
}

/**
 * Build HTML table rows from cards array
 * @param {Array} cards
 */
function renderTable(cards) {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;

  if (!cards || cards.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Chưa có thẻ nào được đăng ký</td></tr>';
    return;
  }

  tbody.innerHTML = cards.map(card => buildNormalRow(card)).join('');
  attachRowListeners();
}

/**
 * Build a normal display row
 * @param {{card_id: string, person_id: string, person_name: string, access: boolean}} card
 * @returns {string}
 */
function buildNormalRow(card) {
  const accessBadge = card.access
    ? '<span class="badge badge-ok">&#9989; ALLOWED</span>'
    : '<span class="badge badge-error">&#10060; BLOCKED</span>';

  return `<tr data-card-id="${escHtml(card.card_id)}">
    <td class="card-id-cell">${escHtml(card.card_id)}</td>
    <td class="person-id-cell">${escHtml(card.person_id)}</td>
    <td>${escHtml(card.person_name)}</td>
    <td>${accessBadge}</td>
    <td class="actions-cell">
      <button class="btn-edit" data-id="${escHtml(card.card_id)}">&#9998; Edit</button>
      <button class="btn-delete" data-id="${escHtml(card.card_id)}">&#128465; Del</button>
    </td>
  </tr>`;
}

/**
 * Build an inline edit row
 * @param {{card_id: string, person_id: string, person_name: string, access: boolean}} card
 * @returns {string}
 */
function buildEditRow(card) {
  const checkedAttr = card.access ? 'checked' : '';
  return `<tr data-card-id="${escHtml(card.card_id)}" class="editing-row">
    <td class="card-id-cell">${escHtml(card.card_id)}</td>
    <td>
      <input type="text" class="admin-input" id="edit-person-id-${escHtml(card.card_id)}"
        value="${escHtml(card.person_id)}" placeholder="Person ID" />
    </td>
    <td>
      <input type="text" class="admin-input" id="edit-person-name-${escHtml(card.card_id)}"
        value="${escHtml(card.person_name)}" placeholder="Tên người dùng" />
    </td>
    <td>
      <label class="toggle-label toggle-small">
        <input type="checkbox" id="edit-access-${escHtml(card.card_id)}" ${checkedAttr} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
        <span class="toggle-text-small">${card.access ? 'Allowed' : 'Blocked'}</span>
      </label>
    </td>
    <td class="actions-cell">
      <button class="btn-save" data-id="${escHtml(card.card_id)}">&#10003; Lưu</button>
      <button class="btn-cancel" data-id="${escHtml(card.card_id)}">&#10007; Huỷ</button>
    </td>
  </tr>`;
}

/**
 * Attach event listeners to Edit/Delete buttons after table render
 */
function attachRowListeners() {
  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => enableEditRow(btn.dataset.id));
  });
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (confirm(`Xóa thẻ ${id}?`)) {
        deleteCard(id);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Inline Edit
// ---------------------------------------------------------------------------

/**
 * Convert a row to edit mode
 * @param {string} cardId
 */
function enableEditRow(cardId) {
  const card = cardsState.find(c => c.card_id === cardId);
  if (!card) return;

  const row = document.querySelector(`tr[data-card-id="${CSS.escape(cardId)}"]`);
  if (!row) return;

  row.outerHTML = buildEditRow(card);

  // Attach listeners for the new edit row buttons
  const saveBtn = document.querySelector(`.btn-save[data-id="${CSS.escape(cardId)}"]`);
  const cancelBtn = document.querySelector(`.btn-cancel[data-id="${CSS.escape(cardId)}"]`);

  if (saveBtn) saveBtn.addEventListener('click', () => saveEditRow(cardId));
  if (cancelBtn) cancelBtn.addEventListener('click', () => cancelEditRow(cardId));

  // Toggle label update
  const accessChk = document.getElementById(`edit-access-${cardId}`);
  const labelSpan = accessChk?.parentElement?.querySelector('.toggle-text-small');
  if (accessChk && labelSpan) {
    accessChk.addEventListener('change', () => {
      labelSpan.textContent = accessChk.checked ? 'Allowed' : 'Blocked';
    });
  }
}

/**
 * Collect inputs and call updateCard, then reload table
 * @param {string} cardId
 */
async function saveEditRow(cardId) {
  const personIdInput = document.getElementById(`edit-person-id-${cardId}`);
  const personNameInput = document.getElementById(`edit-person-name-${cardId}`);
  const accessInput = document.getElementById(`edit-access-${cardId}`);

  if (!personIdInput || !personNameInput || !accessInput) return;

  const personId = personIdInput.value.trim();
  const personName = personNameInput.value.trim();
  const access = accessInput.checked;

  if (!personId) { showToast('Person ID không được để trống', 'error'); return; }
  if (personName.length < 2) { showToast('Tên người dùng phải ít nhất 2 ký tự', 'error'); return; }

  const ok = await updateCard(cardId, { person_id: personId, person_name: personName, access });
  if (ok) {
    await loadCards();
  }
}

/**
 * Cancel edit — restore the original row
 * @param {string} cardId
 */
function cancelEditRow(cardId) {
  const card = cardsState.find(c => c.card_id === cardId);
  if (!card) return;

  const row = document.querySelector(`tr[data-card-id="${CSS.escape(cardId)}"]`);
  if (!row) return;

  row.outerHTML = buildNormalRow(card);
  attachRowListeners();
}

// ---------------------------------------------------------------------------
// Add Card Form
// ---------------------------------------------------------------------------

function resetAddForm() {
  const form = document.getElementById('add-card-form');
  if (form) form.reset();
  const accessLabel = document.getElementById('access-label-text');
  if (accessLabel) accessLabel.textContent = '✓ Cho phép';
}

/**
 * Validate form and call addCard
 * @param {SubmitEvent} e
 */
async function handleFormSubmit(e) {
  e.preventDefault();

  const cardIdRaw = document.getElementById('input-card-id').value;
  const cardId = normalizeCardId(cardIdRaw);
  const personId = document.getElementById('input-person-id').value.trim();
  const personName = document.getElementById('input-person-name').value.trim();
  const access = document.getElementById('input-access').checked;

  // Validation
  if (!cardId) {
    showToast('Card ID không được để trống và chỉ chứa ký tự hex [0-9A-F]', 'error');
    return;
  }
  if (!personId) {
    showToast('Person ID không được để trống', 'error');
    return;
  }
  if (personName.length < 2) {
    showToast('Tên người dùng phải ít nhất 2 ký tự', 'error');
    return;
  }

  // Update the input to show normalized value
  document.getElementById('input-card-id').value = cardId;

  const btn = document.getElementById('btn-add-card');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang thêm...'; }

  await addCard({ card_id: cardId, person_id: personId, person_name: personName, access });

  if (btn) { btn.disabled = false; btn.textContent = '+ Thêm thẻ'; }
}

// ---------------------------------------------------------------------------
// HTML escape helper
// ---------------------------------------------------------------------------

/**
 * @param {string} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Load cards on page load
  loadCards();

  // Add card form submit
  const form = document.getElementById('add-card-form');
  if (form) form.addEventListener('submit', handleFormSubmit);

  // Refresh button
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', loadCards);

  // card_id input: auto-uppercase + strip non-hex on input event
  const cardIdInput = document.getElementById('input-card-id');
  if (cardIdInput) {
    cardIdInput.addEventListener('input', function () {
      const pos = this.selectionStart;
      const normalized = normalizeCardId(this.value);
      this.value = normalized;
      // Restore cursor position
      this.setSelectionRange(pos, pos);
    });
  }

  // Access toggle label update
  const accessChk = document.getElementById('input-access');
  const accessLabel = document.getElementById('access-label-text');
  if (accessChk && accessLabel) {
    accessChk.addEventListener('change', () => {
      accessLabel.textContent = accessChk.checked ? '✓ Cho phép' : '○ Chặn';
    });
  }
});
