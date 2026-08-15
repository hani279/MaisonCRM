const state = {
  page: 'pipeline', // 'pipeline' | 'settings'
  pipeline: 'client',
  clientView: 'board', // 'board' | 'completed' | 'archived'
  stages: [],
  clients: [],
  archivedClients: [],
  partners: [],
  search: '',
  lastTouchedId: null,
  labels: [],
  filters: {
    labelIds: new Set(),
    statuses: new Set(),
    partnerIds: new Set(),
  },
  currentUser: null,
};

const modalMotion = {};
const toggleSprings = {};

const el = (id) => document.getElementById(id);

async function api(url, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (window.supabaseClient) {
    const { data } = await window.supabaseClient.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }

  const res = await fetch(url, { headers, ...opts });
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    // Session expired mid-use — bounce back to the login screen instead of a raw error.
    showAuthScreen('login');
    throw new Error('Session expired — please sign in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function toAppUser(user) {
  return {
    id: user.id,
    name: (user.user_metadata && user.user_metadata.name) || '',
    email: user.email,
    role: (user.user_metadata && user.user_metadata.role) || 'member',
  };
}

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const diffMs = Date.now() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30);
  return `${months}mo ago`;
}

function callTypeLabel(type) {
  return { call: 'Call', text: 'Text', voicemail: 'Voicemail' }[type] || type;
}

// ---------- Loading ----------

async function loadStages() {
  state.stages = await api(`/api/stages?pipeline=${state.pipeline}`);
}

async function loadClients() {
  state.clients = await api('/api/clients');
}

async function loadArchivedClients() {
  state.archivedClients = await api('/api/clients?archived=1');
}

async function loadPartners() {
  state.partners = await api('/api/partners');
}

async function loadLabels() {
  state.labels = await api('/api/labels');
}

async function refreshAll() {
  await Promise.all([loadStages(), loadLabels()]);
  if (state.pipeline === 'client') {
    const loads = [loadClients(), loadPartners()];
    if (state.clientView === 'archived') loads.push(loadArchivedClients());
    await Promise.all(loads);
  } else {
    await loadPartners();
  }
  render();
}

// ---------- Rendering ----------

const VIEW_COPY = {
  board: ['Client Pipeline', ''],
  completed: ['Completed Clients', ''],
  archived: ['Archived Clients', ''],
};

function setPageHeader(title, subtitle) {
  el('pageTitle').textContent = title;
  el('pageSubtitle').textContent = subtitle || '';
  el('pageSubtitle').classList.toggle('hidden', !subtitle);
}

function renderKanban(records, isClient) {
  el('board').classList.remove('hidden');
  el('listView').classList.add('hidden');
  const board = el('board');
  board.innerHTML = '';
  state.stages.forEach((stage, i) => {
    const stageRecords = records.filter((r) => r.stage_id === stage.id);
    board.appendChild(renderColumn(stage, i, stageRecords, isClient));
  });
}

function matchesFilters(record, isClient) {
  const f = state.filters;
  if (f.labelIds.size > 0) {
    const recordLabelIds = (record.labels || []).map((l) => l.id);
    if (!recordLabelIds.some((id) => f.labelIds.has(id))) return false;
  }
  if (isClient) {
    if (f.statuses.size > 0 && !f.statuses.has(record.status)) return false;
    if (f.partnerIds.size > 0 && !f.partnerIds.has(record.referred_by_partner_id)) return false;
  }
  return true;
}

function render() {
  const isClient = state.pipeline === 'client';
  if (!isClient) state.clientView = 'board';

  el('clientViewTabs').classList.toggle('hidden', !isClient);
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === state.clientView);
  });
  renderFilterPanelSections();
  updateFilterBadge();

  const q = state.search.trim().toLowerCase();

  if (!isClient) {
    setPageHeader('Referred Partners', '');
    el('addBtn').textContent = '+ Add Partner';

    const matchesSearch = (r) => [r.company_name, r.contact_name, r.mobile, r.email].join(' ').toLowerCase().includes(q);
    const filtered = state.partners.filter((r) => (!q || matchesSearch(r)) && matchesFilters(r, false));
    renderKanban(filtered, false);
    animateTouchedCard();
    return;
  }

  const [title, subtitle] = VIEW_COPY[state.clientView];
  setPageHeader(title, subtitle);
  el('addBtn').textContent = '+ Add Client';

  const matchesSearch = (c) => [c.name, c.phone, c.email, c.budget_label].join(' ').toLowerCase().includes(q);

  if (state.clientView === 'board') {
    const filtered = state.clients.filter((c) => (!q || matchesSearch(c)) && matchesFilters(c, true));
    renderKanban(filtered, true);
    animateTouchedCard();
    return;
  }

  el('board').classList.add('hidden');
  el('listView').classList.remove('hidden');

  if (state.clientView === 'completed') {
    const lastStage = state.stages[state.stages.length - 1];
    const filtered = (lastStage ? state.clients.filter((c) => c.stage_id === lastStage.id) : [])
      .filter((c) => (!q || matchesSearch(c)) && matchesFilters(c, true));
    renderListView(filtered, 'completed');
    animateTouchedCard();
    return;
  }

  const filtered = state.archivedClients.filter((c) => (!q || matchesSearch(c)) && matchesFilters(c, true));
  renderListView(filtered, 'archived');
  animateTouchedCard();
}

// ---------- Filter panel ----------

const STATUS_LABELS = { cold: 'Cold', engaged: 'Engaged', active: 'Active / Hot', settled: 'Settled', lost: 'Lost' };

function renderFilterPanelSections() {
  const isClient = state.pipeline === 'client';
  el('filterStatusSection').classList.toggle('hidden', !isClient);
  el('filterPartnerSection').classList.toggle('hidden', !isClient);

  const labelsList = el('filterLabelsList');
  labelsList.innerHTML = state.labels.length === 0
    ? '<span class="text-muted">No labels yet.</span>'
    : state.labels.map((l) => `
        <label>
          <input type="checkbox" data-filter="label" value="${l.id}" ${state.filters.labelIds.has(l.id) ? 'checked' : ''} />
          <span class="filter-swatch-dot" style="background:${l.color};"></span>
          ${escapeHtml(l.name)}
        </label>
      `).join('');

  if (isClient) {
    el('filterStatusList').innerHTML = Object.entries(STATUS_LABELS).map(([value, label]) => `
      <label>
        <input type="checkbox" data-filter="status" value="${value}" ${state.filters.statuses.has(value) ? 'checked' : ''} />
        ${label}
      </label>
    `).join('');

    const partnerList = el('filterPartnerList');
    partnerList.innerHTML = state.partners.length === 0
      ? '<span class="text-muted">No partners yet.</span>'
      : state.partners.map((p) => `
          <label>
            <input type="checkbox" data-filter="partner" value="${p.id}" ${state.filters.partnerIds.has(p.id) ? 'checked' : ''} />
            ${escapeHtml(p.company_name || p.contact_name)}
          </label>
        `).join('');
  }

  el('filterPanel').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', handleFilterCheckboxChange);
  });
}

function handleFilterCheckboxChange(e) {
  const type = e.target.dataset.filter;
  const value = type === 'status' ? e.target.value : Number(e.target.value);
  const set = type === 'label' ? state.filters.labelIds
    : type === 'status' ? state.filters.statuses
    : state.filters.partnerIds;
  if (e.target.checked) set.add(value); else set.delete(value);
  render();
}

function updateFilterBadge() {
  const count = state.filters.labelIds.size + state.filters.statuses.size + state.filters.partnerIds.size;
  const badge = el('filterBadge');
  badge.textContent = String(count);
  badge.classList.toggle('hidden', count === 0);
  el('filterBtn').classList.toggle('active', count > 0);
}

function clearFilters() {
  state.filters.labelIds.clear();
  state.filters.statuses.clear();
  state.filters.partnerIds.clear();
  render();
}

function renderListView(records, mode) {
  const container = el('listView');
  container.innerHTML = '';

  if (records.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-column';
    empty.textContent = mode === 'archived' ? 'No archived clients' : 'No completed clients yet';
    container.appendChild(empty);
    return;
  }

  records.forEach((client) => {
    container.appendChild(mode === 'archived' ? renderArchivedClientCard(client) : renderCompletedClientCard(client));
  });
}

function renderColumn(stage, index, records, isClient) {
  const col = document.createElement('div');
  col.className = 'column';

  const header = document.createElement('div');
  header.className = 'column-header';
  header.innerHTML = `
    <div class="column-badge">${String(index + 1).padStart(2, '0')}</div>
    <div class="column-title-group">
      <h3>${escapeHtml(stage.name)}</h3>
      <span>${records.length} ${records.length === 1 ? (isClient ? 'client' : 'partner') : (isClient ? 'clients' : 'partners')}</span>
    </div>`;
  col.appendChild(header);

  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'column-cards';

  if (records.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-column';
    empty.textContent = 'No records';
    cardsWrap.appendChild(empty);
  } else {
    records.forEach((r) => {
      cardsWrap.appendChild(isClient ? renderClientCard(r, index) : renderPartnerCard(r, index));
    });
  }

  col.appendChild(cardsWrap);
  return col;
}

// Makes the whole card open the edit modal, except clicks on an action button
// inside it (Back/Next/Log Call/Archive/Restore/Delete keep their own behavior).
function bindCardOpensEdit(card, onEdit) {
  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    onEdit();
  });
}

function renderClientCard(client, stageIndex) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.recordId = client.id;

  const metaParts = [client.phone, client.budget_label].filter(Boolean).join(' · ');
  const lastContact = client.last_contact
    ? `<div class="last-contact">Last contact: ${callTypeLabel(client.last_contact.type)} · ${formatRelative(client.last_contact.logged_at)}</div>`
    : '';
  const nextAction = client.next_action_label
    ? `<div class="next-action-pill">${escapeHtml(client.next_action_label)}${client.next_action_date ? ' — ' + escapeHtml(client.next_action_date) : ''}</div>`
    : '';

  const isFirst = stageIndex === 0;
  const isLast = stageIndex === state.stages.length - 1;

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(client.name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
    ${renderLabelChips(client.labels)}
    ${nextAction}
    ${lastContact}
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back" ${isFirst ? 'disabled' : ''}>&larr; Back</button>
      <button class="card-icon-btn" data-action="log-call" title="Log call/text/voicemail">☎</button>
      <button class="btn btn-add btn-tiny" data-action="next" ${isLast ? 'disabled' : ''}>Next &rarr;</button>
    </div>
  `;

  bindCardOpensEdit(card, () => openClientModal(client));
  card.querySelector('[data-action="back"]').addEventListener('click', () => moveClient(client.id, 'back'));
  card.querySelector('[data-action="next"]').addEventListener('click', () => moveClient(client.id, 'next'));
  card.querySelector('[data-action="log-call"]').addEventListener('click', () => openCallModal(client.id));

  return card;
}

function renderPartnerCard(partner, stageIndex) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.recordId = partner.id;

  const metaParts = [partner.mobile, partner.email].filter(Boolean).join(' · ');
  const isFirst = stageIndex === 0;
  const isLast = stageIndex === state.stages.length - 1;

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(partner.company_name || partner.contact_name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(partner.contact_name)}${metaParts ? ' · ' + escapeHtml(metaParts) : ''}</div>
    ${renderLabelChips(partner.labels)}
    <div class="partner-count">${partner.referred_client_count} client${partner.referred_client_count === 1 ? '' : 's'} referred</div>
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back" ${isFirst ? 'disabled' : ''}>&larr; Back</button>
      <button class="btn btn-add btn-tiny" data-action="next" ${isLast ? 'disabled' : ''}>Next &rarr;</button>
    </div>
  `;

  bindCardOpensEdit(card, () => openPartnerModal(partner));
  card.querySelector('[data-action="back"]').addEventListener('click', () => movePartner(partner.id, 'back'));
  card.querySelector('[data-action="next"]').addEventListener('click', () => movePartner(partner.id, 'next'));

  return card;
}

function renderCompletedClientCard(client) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.recordId = client.id;

  const metaParts = [client.phone, client.budget_label].filter(Boolean).join(' · ');
  const lastContact = client.last_contact
    ? `<div class="last-contact">Last contact: ${callTypeLabel(client.last_contact.type)} · ${formatRelative(client.last_contact.logged_at)}</div>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(client.name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
    ${renderLabelChips(client.labels)}
    ${lastContact}
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back">&larr; Back</button>
      <button class="card-icon-btn" data-action="log-call" title="Log call/text/voicemail">☎</button>
      <button class="btn btn-secondary btn-tiny" data-action="archive">Archive</button>
    </div>
  `;

  bindCardOpensEdit(card, () => openClientModal(client));
  card.querySelector('[data-action="back"]').addEventListener('click', () => moveClient(client.id, 'back'));
  card.querySelector('[data-action="log-call"]').addEventListener('click', () => openCallModal(client.id));
  card.querySelector('[data-action="archive"]').addEventListener('click', () => archiveClient(client.id));

  return card;
}

function renderArchivedClientCard(client) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.recordId = client.id;

  const metaParts = [client.phone, client.budget_label].filter(Boolean).join(' · ');

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(client.name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
    ${renderLabelChips(client.labels)}
    <div class="last-contact">Archived ${formatRelative(client.archived_at)}</div>
    <div class="card-actions">
      <button class="btn btn-add btn-tiny" data-action="restore">Restore</button>
      <button class="btn btn-danger btn-tiny" data-action="delete">Delete</button>
    </div>
  `;

  bindCardOpensEdit(card, () => openClientModal(client));
  card.querySelector('[data-action="restore"]').addEventListener('click', () => restoreClient(client.id));
  card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteArchivedClient(client.id));

  return card;
}

function animateTouchedCard() {
  if (!state.lastTouchedId) return;
  const id = state.lastTouchedId;
  state.lastTouchedId = null;

  const cardEl = document.querySelector(`.card[data-record-id="${id}"]`);
  if (!cardEl || Spring.prefersReducedMotion()) return;

  cardEl.style.opacity = '0';
  cardEl.style.transform = 'translateY(6px) scale(0.98)';

  Spring.animate({
    from: 0,
    to: 1,
    damping: 1,
    response: 0.4,
    onUpdate: (t) => {
      cardEl.style.opacity = t;
      cardEl.style.transform = `translateY(${6 * (1 - t)}px) scale(${0.98 + 0.02 * t})`;
    },
    onComplete: () => {
      cardEl.style.opacity = '';
      cardEl.style.transform = '';
    },
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLabelChips(labels) {
  if (!labels || labels.length === 0) return '';
  const chips = labels
    .map((l) => `<span class="label-chip" style="background:${l.color}22; color:${l.color};">${escapeHtml(l.name)}</span>`)
    .join('');
  return `<div class="card-label-chips">${chips}</div>`;
}

// ---------- Move actions ----------

async function moveClient(id, direction) {
  await api(`/api/clients/${id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) });
  await loadClients();
  state.lastTouchedId = id;
  render();
}

async function movePartner(id, direction) {
  await api(`/api/partners/${id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) });
  await loadPartners();
  state.lastTouchedId = id;
  render();
}

// ---------- Archive / restore ----------

async function archiveClient(id) {
  await api(`/api/clients/${id}/archive`, { method: 'PATCH' });
  await loadClients();
  render();
}

async function restoreClient(id) {
  await api(`/api/clients/${id}/restore`, { method: 'PATCH' });
  state.clientView = 'board';
  state.lastTouchedId = id;
  await loadClients();
  render();
}

async function deleteArchivedClient(id) {
  if (!confirm('Permanently delete this client? This cannot be undone.')) return;
  await api(`/api/clients/${id}`, { method: 'DELETE' });
  await loadArchivedClients();
  render();
}

async function toggleArchiveFromModal() {
  const id = el('recordId').value;
  if (!id) return;
  const wasArchived = modalClientArchived;
  const endpoint = wasArchived ? 'restore' : 'archive';
  await api(`/api/clients/${id}/${endpoint}`, { method: 'PATCH' });

  if (wasArchived) {
    // Restoring should always land you back on the live board, not the now-empty Archived tab.
    state.clientView = 'board';
    state.lastTouchedId = Number(id);
    await loadClients();
  } else {
    await Promise.all([
      loadClients(),
      state.clientView === 'archived' ? loadArchivedClients() : Promise.resolve(null),
    ]);
  }

  closeModal('recordModal');
  render();
}

// ---------- Add/Edit modal ----------

let modalClientArchived = false;

// ---------- Budget range dropdowns ----------

const BUDGET_MIN = 450000;
const BUDGET_MAX = 2000000;
const BUDGET_STEP = 50000;
let originalBudgetLabel = null;

function budgetSteps() {
  const values = [];
  for (let v = BUDGET_MIN; v <= BUDGET_MAX; v += BUDGET_STEP) values.push(v);
  return values;
}

function formatMoney(v) {
  return '$' + v.toLocaleString('en-US');
}

function populateBudgetSelects() {
  const fromSelect = el('f_budget_from');
  fromSelect.innerHTML = '<option value="">— Any —</option>' +
    budgetSteps().map((v) => `<option value="${v}">${formatMoney(v)}</option>`).join('');
  updateBudgetToOptions();
}

// "To" only offers values >= the chosen "From", so you can't build a nonsense range.
function updateBudgetToOptions() {
  const fromVal = Number(el('f_budget_from').value) || 0;
  const toSelect = el('f_budget_to');
  const current = toSelect.value;
  const values = budgetSteps().filter((v) => v >= fromVal);
  toSelect.innerHTML = '<option value="">— No max —</option>' +
    values.map((v) => `<option value="${v}">${formatMoney(v)}</option>`).join('');
  if (values.includes(Number(current))) toSelect.value = current;
}

// Parses "$450,000 - $700,000" / "$700,000+" style labels back into the two
// dropdowns. Anything else (free text from a CSV import, e.g. "700k") is left
// unparsed — computeBudgetLabel() then preserves it untouched unless the user
// actively picks new dropdown values.
function parseBudgetLabel(label) {
  if (!label) return null;
  const steps = new Set(budgetSteps());

  let m = label.match(/^\$?([\d,]+)\s*-\s*\$?([\d,]+)$/);
  if (m) {
    const from = Number(m[1].replace(/,/g, ''));
    const to = Number(m[2].replace(/,/g, ''));
    if (steps.has(from) && steps.has(to)) return { from, to };
  }

  m = label.match(/^\$?([\d,]+)\+$/);
  if (m) {
    const from = Number(m[1].replace(/,/g, ''));
    if (steps.has(from)) return { from, to: null };
  }

  return null;
}

function setBudgetSelects(label) {
  const parsed = parseBudgetLabel(label);
  el('f_budget_from').value = parsed ? parsed.from : '';
  updateBudgetToOptions();
  el('f_budget_to').value = parsed && parsed.to ? parsed.to : '';
}

function computeBudgetLabel() {
  const fromVal = el('f_budget_from').value;
  const toVal = el('f_budget_to').value;
  if (!fromVal && !toVal) return originalBudgetLabel;
  if (fromVal && toVal) return `${formatMoney(Number(fromVal))} - ${formatMoney(Number(toVal))}`;
  if (fromVal) return `${formatMoney(Number(fromVal))}+`;
  return `Up to ${formatMoney(Number(toVal))}`;
}

function populateReferredByOptions() {
  const select = el('f_referred_by_partner_id');
  const current = select.value;
  select.innerHTML = '<option value="">— None —</option>';
  state.partners.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.company_name ? `${p.company_name} (${p.contact_name})` : p.contact_name;
    select.appendChild(opt);
  });
  select.value = current;
}

// ---------- Label picker (shared by client + partner modals) ----------

let selectedLabelIds = new Set();
let originalLabelIds = new Set();

function populateLabelPicker(currentLabels) {
  originalLabelIds = new Set((currentLabels || []).map((l) => l.id));
  selectedLabelIds = new Set(originalLabelIds);

  const container = el('labelCheckboxes');
  if (state.labels.length === 0) {
    container.innerHTML = '<span class="text-muted">No labels yet — create some in Settings.</span>';
    return;
  }

  container.innerHTML = state.labels.map((l) => `
    <button type="button" class="label-chip" data-label-id="${l.id}"
      style="${selectedLabelIds.has(l.id) ? `background:${l.color}; color:#fff;` : `color:${l.color}; border-color:${l.color}66;`}">
      ${escapeHtml(l.name)}
    </button>
  `).join('');

  container.querySelectorAll('.label-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.labelId);
      const label = state.labels.find((l) => l.id === id);
      if (selectedLabelIds.has(id)) {
        selectedLabelIds.delete(id);
        btn.style.background = '';
        btn.style.color = label.color;
        btn.style.borderColor = `${label.color}66`;
      } else {
        selectedLabelIds.add(id);
        btn.style.background = label.color;
        btn.style.color = '#fff';
        btn.style.borderColor = 'transparent';
      }
    });
  });
}

async function syncRecordLabels(type, id) {
  const toAdd = [...selectedLabelIds].filter((labelId) => !originalLabelIds.has(labelId));
  const toRemove = [...originalLabelIds].filter((labelId) => !selectedLabelIds.has(labelId));
  const base = type === 'client' ? `/api/clients/${id}/labels` : `/api/partners/${id}/labels`;

  await Promise.all([
    ...toAdd.map((labelId) => api(base, { method: 'POST', body: JSON.stringify({ label_id: labelId }) })),
    ...toRemove.map((labelId) => api(`${base}/${labelId}`, { method: 'DELETE' })),
  ]);
}

function openClientModal(client) {
  el('recordModalTitle').textContent = client ? 'Edit Client' : 'Add Client';
  el('recordId').value = client ? client.id : '';
  el('clientFields').classList.remove('hidden');
  el('partnerFields').classList.add('hidden');
  el('f_name').required = true;
  el('p_contact_name').required = false;
  el('recordForm').dataset.type = 'client';

  populateReferredByOptions();

  el('f_name').value = client?.name || '';
  el('f_phone').value = client?.phone || '';
  el('f_email').value = client?.email || '';
  originalBudgetLabel = client?.budget_label || null;
  populateBudgetSelects();
  setBudgetSelects(client?.budget_label || null);
  el('f_status').value = client?.status || 'cold';
  el('f_next_action_label').value = client?.next_action_label || '';
  el('f_next_action_date').value = client?.next_action_date || '';
  el('f_referred_by_partner_id').value = client?.referred_by_partner_id || '';
  el('f_referral_fee_note').value = client?.referral_fee_note || '';
  el('f_notes').value = client?.notes || '';

  el('deleteRecordBtn').classList.toggle('hidden', !client);

  modalClientArchived = !!(client && client.archived_at);
  el('archiveRecordBtn').textContent = modalClientArchived ? 'Restore' : 'Archive';
  el('archiveRecordBtn').classList.toggle('hidden', !client);

  populateLabelPicker(client?.labels);

  openModal('recordModal');
}

function openPartnerModal(partner) {
  el('recordModalTitle').textContent = partner ? 'Edit Partner' : 'Add Partner';
  el('recordId').value = partner ? partner.id : '';
  el('clientFields').classList.add('hidden');
  el('partnerFields').classList.remove('hidden');
  el('f_name').required = false;
  el('p_contact_name').required = true;
  el('recordForm').dataset.type = 'partner';

  el('p_company_name').value = partner?.company_name || '';
  el('p_contact_name').value = partner?.contact_name || '';
  el('p_mobile').value = partner?.mobile || '';
  el('p_email').value = partner?.email || '';
  el('p_notes').value = partner?.notes || '';

  el('deleteRecordBtn').classList.toggle('hidden', !partner);
  el('archiveRecordBtn').classList.add('hidden');

  populateLabelPicker(partner?.labels);

  openModal('recordModal');
}

async function submitRecordForm(evt) {
  evt.preventDefault();
  const type = el('recordForm').dataset.type;
  const id = el('recordId').value;

  if (type === 'client') {
    const payload = {
      name: el('f_name').value,
      phone: el('f_phone').value,
      email: el('f_email').value,
      budget_label: computeBudgetLabel(),
      status: el('f_status').value,
      next_action_label: el('f_next_action_label').value,
      next_action_date: el('f_next_action_date').value,
      referred_by_partner_id: el('f_referred_by_partner_id').value || null,
      referral_fee_note: el('f_referral_fee_note').value,
      notes: el('f_notes').value,
    };
    const saved = id
      ? await api(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
    await syncRecordLabels('client', saved.id);
    state.lastTouchedId = saved.id;
    await loadClients();
  } else {
    const payload = {
      company_name: el('p_company_name').value,
      contact_name: el('p_contact_name').value,
      mobile: el('p_mobile').value,
      email: el('p_email').value,
      notes: el('p_notes').value,
    };
    const saved = id
      ? await api(`/api/partners/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/partners', { method: 'POST', body: JSON.stringify(payload) });
    await syncRecordLabels('partner', saved.id);
    state.lastTouchedId = saved.id;
    await loadPartners();
  }

  closeModal('recordModal');
  render();
}

async function deleteRecord() {
  const type = el('recordForm').dataset.type;
  const id = el('recordId').value;
  if (!id) return;
  if (!confirm(`Delete this ${type}? This cannot be undone.`)) return;

  if (type === 'client') {
    await api(`/api/clients/${id}`, { method: 'DELETE' });
    await loadClients();
    if (state.clientView === 'archived') await loadArchivedClients();
  } else {
    await api(`/api/partners/${id}`, { method: 'DELETE' });
    await loadPartners();
  }
  closeModal('recordModal');
  render();
}

// ---------- Call log modal ----------

function openCallModal(clientId) {
  el('call_client_id').value = clientId;
  el('call_note').value = '';
  document.querySelector('input[name="call_type"][value="call"]').checked = true;
  openModal('callModal');
}

async function submitCallForm(evt) {
  evt.preventDefault();
  const clientId = el('call_client_id').value;
  const type = document.querySelector('input[name="call_type"]:checked').value;
  const note = el('call_note').value;

  await api(`/api/clients/${clientId}/calls`, {
    method: 'POST',
    body: JSON.stringify({ type, note }),
  });

  state.lastTouchedId = Number(clientId);
  await loadClients();
  closeModal('callModal');
  render();
}

// ---------- Modal plumbing ----------
// Materialize in/out: a single spring drives a 0..1 progress value applied to both
// the backdrop's opacity and the dialog's opacity + scale, so open/close reads as
// one real surface arriving/leaving rather than a plain visibility toggle. Each
// modal tracks its own live progress so re-triggering mid-animation is interruptible
// and continues from wherever it currently is, instead of jumping.

function getModalMotion(id) {
  if (!modalMotion[id]) modalMotion[id] = { progress: 0 };
  return modalMotion[id];
}

function applyModalProgress(id, t) {
  const overlay = el(id);
  const dialog = overlay.querySelector('.modal');
  overlay.style.opacity = t;
  overlay.style.pointerEvents = t > 0.02 ? 'auto' : 'none';
  dialog.style.opacity = t;
  dialog.style.transform = `scale(${0.96 + 0.04 * t})`;
}

function openModal(id) {
  const overlay = el(id);
  overlay.classList.remove('hidden');

  const motion = getModalMotion(id);
  if (motion.controller) motion.controller.cancel();
  motion.controller = Spring.animate({
    from: motion.progress,
    to: 1,
    damping: 1,
    response: 0.35,
    onUpdate: (t) => {
      motion.progress = t;
      applyModalProgress(id, t);
    },
  });
}

function closeModal(id) {
  const motion = getModalMotion(id);
  if (motion.controller) motion.controller.cancel();
  motion.controller = Spring.animate({
    from: motion.progress,
    to: 0,
    damping: 1,
    response: 0.3,
    onUpdate: (t) => {
      motion.progress = t;
      applyModalProgress(id, t);
    },
    onComplete: () => {
      el(id).classList.add('hidden');
    },
  });
}

// ---------- Pipeline toggle indicator ----------
// The pill behind Clients/Referral Partners slides to the active button rather than
// snapping, and always animates from its current on-screen position (not the target),
// so rapid re-toggling stays smooth instead of restarting from scratch each time.

function positionToggleIndicator(animateMotion) {
  const container = el('pipelineToggle');
  const indicator = el('toggleIndicator');
  const activeBtn = container.querySelector('.toggle-btn.active');
  if (!activeBtn) return;

  const target = { left: activeBtn.offsetLeft, width: activeBtn.offsetWidth };

  if (!animateMotion || Spring.prefersReducedMotion()) {
    indicator.style.left = `${target.left}px`;
    indicator.style.width = `${target.width}px`;
    return;
  }

  const current = {
    left: parseFloat(indicator.style.left) || target.left,
    width: parseFloat(indicator.style.width) || target.width,
  };

  if (toggleSprings.left) toggleSprings.left.cancel();
  if (toggleSprings.width) toggleSprings.width.cancel();

  toggleSprings.left = Spring.animate({
    from: current.left,
    to: target.left,
    damping: 1,
    response: 0.35,
    onUpdate: (v) => { indicator.style.left = `${v}px`; },
  });
  toggleSprings.width = Spring.animate({
    from: current.width,
    to: target.width,
    damping: 1,
    response: 0.35,
    onUpdate: (v) => { indicator.style.width = `${v}px`; },
  });
}

// ---------- Settings page ----------

function setPage(page) {
  state.page = page;
  const isSettings = page === 'settings';

  el('settingsBtn').textContent = isSettings ? '← Back to Pipeline' : '⚙ Settings';
  el('addBtn').classList.toggle('hidden', isSettings);
  el('pipelineToggle').classList.toggle('hidden', isSettings);
  el('toolbar').classList.toggle('hidden', isSettings);
  el('settingsView').classList.toggle('hidden', !isSettings);

  if (isSettings) {
    el('clientViewTabs').classList.add('hidden');
    el('board').classList.add('hidden');
    el('listView').classList.add('hidden');
    setPageHeader('Settings', '');
    loadSettingsPanel();
  } else {
    render();
  }
}

function loadSettingsPanel() {
  el('importMapping').classList.add('hidden');
  el('importResult').classList.add('hidden');
  el('importFileInput').value = '';
  el('importFileName').textContent = '';

  renderColorSwatchPicker();
  renderLabelsList();
  loadAccountPanel();
}

// ---------- Settings: Account + Users ----------

function loadAccountPanel() {
  const user = state.currentUser;
  if (!user) return;

  el('accountCurrentName').textContent = user.name;
  el('accountCurrentEmail').textContent = user.email;
  el('account_name').value = user.name;
  el('account_email').value = user.email;
  el('account_password').value = '';
  el('account_password_confirm').value = '';
  el('profileResult').classList.add('hidden');

  el('usersSection').classList.toggle('hidden', user.role !== 'admin');
  if (user.role === 'admin') loadUsersList();
}

async function saveProfile() {
  const password = el('account_password').value;
  const confirmPassword = el('account_password_confirm').value;
  if (password && password !== confirmPassword) {
    alert('Passwords do not match.');
    return;
  }

  const name = el('account_name').value.trim();
  const email = el('account_email').value.trim();
  const payload = { email, data: { name, role: state.currentUser.role } };
  if (password) payload.password = password;

  try {
    const { data, error } = await window.supabaseClient.auth.updateUser(payload);
    if (error) throw error;
    state.currentUser = toAppUser(data.user);
    el('accountCurrentName').textContent = state.currentUser.name;
    el('accountCurrentEmail').textContent = state.currentUser.email;
    el('account_password').value = '';
    el('account_password_confirm').value = '';
    el('profileResult').textContent = 'Profile updated.';
    el('profileResult').classList.remove('hidden');
  } catch (err) {
    alert('Could not update profile: ' + err.message);
  }
}

async function logout() {
  await window.supabaseClient.auth.signOut();
  showAuthScreen('login');
}

async function loadUsersList() {
  let users;
  try {
    users = await api('/api/users');
  } catch (err) {
    el('usersList').innerHTML = `<span class="text-muted">${escapeHtml(err.message)}</span>`;
    return;
  }

  el('usersList').innerHTML = users.map((u) => `
    <div class="label-row">
      ${escapeHtml(u.name)} — ${escapeHtml(u.email)} (${u.role})
      ${u.id !== state.currentUser.id ? `<button type="button" class="label-delete-btn" data-user-id="${u.id}" title="Delete user">&times;</button>` : ''}
    </div>
  `).join('');

  el('usersList').querySelectorAll('.label-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteUser(btn.dataset.userId));
  });
}

async function createUser() {
  const payload = {
    name: el('newUserName').value,
    email: el('newUserEmail').value,
    password: el('newUserPassword').value,
    role: el('newUserRole').value,
  };
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    el('newUserName').value = '';
    el('newUserEmail').value = '';
    el('newUserPassword').value = '';
    el('newUserRole').value = 'member';
    await loadUsersList();
  } catch (err) {
    alert('Could not create user: ' + err.message);
  }
}

async function deleteUser(id) {
  if (!confirm("Delete this user? They'll no longer be able to sign in.")) return;
  await api(`/api/users/${id}`, { method: 'DELETE' });
  await loadUsersList();
}

// ---------- Settings: Labels management ----------

const LABEL_COLORS = ['#0071e3', '#5e5ce6', '#30d158', '#ff9500', '#ff3b30', '#ff375f', '#00c7be', '#86868b'];
let newLabelColor = LABEL_COLORS[0];

function renderColorSwatchPicker() {
  const picker = el('newLabelColorPicker');
  picker.innerHTML = LABEL_COLORS.map((c) => `
    <button type="button" class="color-swatch ${c === newLabelColor ? 'selected' : ''}" data-color="${c}" style="background:${c};"></button>
  `).join('');
  picker.querySelectorAll('.color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      newLabelColor = btn.dataset.color;
      picker.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  });
}

function renderLabelsList() {
  const container = el('labelsList');
  if (state.labels.length === 0) {
    container.innerHTML = '<span class="text-muted">No labels yet.</span>';
    return;
  }
  container.innerHTML = state.labels.map((l) => `
    <div class="label-row">
      <span class="label-swatch-dot" style="background:${l.color};"></span>
      ${escapeHtml(l.name)}
      <button type="button" class="label-delete-btn" data-label-id="${l.id}" title="Delete label">&times;</button>
    </div>
  `).join('');
  container.querySelectorAll('.label-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteLabel(Number(btn.dataset.labelId)));
  });
}

async function createLabel() {
  const name = el('newLabelName').value.trim();
  if (!name) { alert('Enter a label name first.'); return; }
  try {
    await api('/api/labels', { method: 'POST', body: JSON.stringify({ name, color: newLabelColor }) });
    el('newLabelName').value = '';
    await loadLabels();
    renderLabelsList();
  } catch (err) {
    alert('Could not create label: ' + err.message);
  }
}

async function deleteLabel(id) {
  if (!confirm("Delete this label? It'll be removed from every client and partner it's assigned to.")) return;
  await api(`/api/labels/${id}`, { method: 'DELETE' });
  await loadLabels();
  renderLabelsList();
}

let importCsvText = '';

async function handleImportFileChosen(file) {
  el('importFileName').textContent = file.name;
  el('importResult').classList.add('hidden');
  importCsvText = await file.text();

  let data;
  try {
    data = await api('/api/clients/import/parse', {
      method: 'POST',
      body: JSON.stringify({ csvText: importCsvText }),
    });
  } catch (err) {
    alert('Could not read that CSV: ' + err.message);
    return;
  }

  populateImportMappingSelects(data.headers, data.suggested);
  renderImportPreview(data.headers, data.sampleRows);
  el('importRowCount').textContent = `${data.rowCount} row${data.rowCount === 1 ? '' : 's'} found`;
  el('importMapping').classList.remove('hidden');
}

function populateImportMappingSelects(headers, suggested) {
  const fields = [
    ['map_nameCol', 'nameCol'],
    ['map_lastNameCol', 'lastNameCol'],
    ['map_phoneCol', 'phoneCol'],
    ['map_emailCol', 'emailCol'],
    ['map_budgetCol', 'budgetCol'],
    ['map_notesCol', 'notesCol'],
  ];
  const options = '<option value="">— None —</option>' +
    headers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join('');

  fields.forEach(([selectId, key]) => {
    const select = el(selectId);
    select.innerHTML = options;
    select.value = suggested[key] || '';
  });
}

function renderImportPreview(headers, rows) {
  const table = el('importPreviewTable');
  if (rows.length === 0) { table.innerHTML = ''; return; }
  const headRow = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const bodyRows = rows
    .map((r) => `<tr>${headers.map((h) => `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`)
    .join('');
  table.innerHTML = `<thead>${headRow}</thead><tbody>${bodyRows}</tbody>`;
}

async function commitImport() {
  const map = {
    nameCol: el('map_nameCol').value,
    lastNameCol: el('map_lastNameCol').value,
    phoneCol: el('map_phoneCol').value,
    emailCol: el('map_emailCol').value,
    budgetCol: el('map_budgetCol').value,
    notesCol: el('map_notesCol').value,
  };
  if (!map.nameCol && !map.lastNameCol) {
    alert('Pick at least a name column before importing.');
    return;
  }

  el('commitImportBtn').disabled = true;
  try {
    const result = await api('/api/clients/import/commit', {
      method: 'POST',
      body: JSON.stringify({ csvText: importCsvText, map }),
    });
    el('importResult').classList.remove('hidden');
    el('importResult').textContent =
      `Imported ${result.imported} client${result.imported === 1 ? '' : 's'}` +
      (result.skipped ? `, skipped ${result.skipped} row${result.skipped === 1 ? '' : 's'} with no name.` : '.');
    el('importMapping').classList.add('hidden');
    el('importFileInput').value = '';
    el('importFileName').textContent = '';
  } catch (err) {
    alert('Import failed: ' + err.message);
  } finally {
    el('commitImportBtn').disabled = false;
  }
}

// ---------- Init ----------

function initEventListeners() {
  el('f_budget_from').addEventListener('change', updateBudgetToOptions);

  el('addBtn').addEventListener('click', () => {
    if (state.pipeline === 'client') openClientModal(null);
    else openPartnerModal(null);
  });

  el('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    render();
  });

  el('settingsBtn').addEventListener('click', () => {
    setPage(state.page === 'settings' ? 'pipeline' : 'settings');
  });

  el('settingsExportBtn').addEventListener('click', () => {
    window.location.href = '/api/clients/export.csv';
  });

  el('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImportFileChosen(file);
  });

  el('commitImportBtn').addEventListener('click', commitImport);
  el('createLabelBtn').addEventListener('click', createLabel);
  el('saveProfileBtn').addEventListener('click', saveProfile);
  el('logoutBtn').addEventListener('click', logout);
  el('createUserBtn').addEventListener('click', createUser);

  el('filterBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    el('filterPanel').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    const panel = el('filterPanel');
    if (!panel.classList.contains('hidden') && !e.target.closest('.filter-wrap')) {
      panel.classList.add('hidden');
    }
  });
  el('clearFiltersBtn').addEventListener('click', clearFilters);

  el('pipelineToggle').addEventListener('click', async (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    el('pipelineToggle').classList.toggle('is-partner', btn.dataset.pipeline === 'partner');
    positionToggleIndicator(true);
    state.pipeline = btn.dataset.pipeline;
    state.clientView = 'board';
    state.search = '';
    el('searchInput').value = '';
    await refreshAll();
  });

  el('clientViewTabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('.view-tab');
    if (!btn || btn.dataset.view === state.clientView) return;
    state.clientView = btn.dataset.view;
    if (state.clientView === 'archived') await loadArchivedClients();
    render();
  });

  window.addEventListener('resize', () => positionToggleIndicator(false));

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  el('recordForm').addEventListener('submit', submitRecordForm);
  el('callForm').addEventListener('submit', submitCallForm);
  el('deleteRecordBtn').addEventListener('click', deleteRecord);
  el('archiveRecordBtn').addEventListener('click', toggleArchiveFromModal);
}

// ---------- Auth screen ----------

let authMode = 'login'; // 'login' | 'setup'

function showAuthScreen(mode) {
  authMode = mode;
  state.currentUser = null;

  el('authView').classList.remove('hidden');
  el('topbarActions').classList.add('hidden');
  el('toolbar').classList.add('hidden');
  el('clientViewTabs').classList.add('hidden');
  el('board').classList.add('hidden');
  el('listView').classList.add('hidden');
  el('settingsView').classList.add('hidden');
  el('filterPanel').classList.add('hidden');
  setPageHeader('Client Pipeline', '');

  el('authTitle').textContent = mode === 'setup' ? 'Create Your Admin Account' : 'Sign In';
  el('authSubtitle').textContent = mode === 'setup'
    ? 'Set up the first account for this CRM.'
    : 'Sign in to continue.';
  el('authNameField').classList.toggle('hidden', mode !== 'setup');
  el('auth_name').required = mode === 'setup';
  el('authSubmitBtn').textContent = mode === 'setup' ? 'Create Account' : 'Sign In';
  el('authError').classList.add('hidden');
  el('auth_email').value = '';
  el('auth_password').value = '';

  el('demoHint').classList.add('hidden');
  if (mode === 'login') {
    fetch('/api/meta').then((r) => r.json()).then((meta) => {
      if (meta.demo) {
        el('demoHint').textContent = 'Demo login: demo@maisons.example / demo1234';
        el('demoHint').classList.remove('hidden');
      }
    }).catch(() => {});
  }
}

async function showApp() {
  el('authView').classList.add('hidden');
  el('topbarActions').classList.remove('hidden');

  positionToggleIndicator(false);
  await refreshAll();

  fetch('/api/meta').then((r) => r.json())
    .then((meta) => el('demoBadge').classList.toggle('hidden', !meta.demo))
    .catch(() => {});
}

async function checkAuthAndInit() {
  await window.supabaseReady;

  let status;
  try {
    status = await fetch('/api/auth/status').then((r) => r.json());
  } catch (err) {
    console.error(err);
    alert('Could not reach the server: ' + err.message);
    return;
  }

  if (status.needsSetup) return showAuthScreen('setup');

  const { data } = await window.supabaseClient.auth.getSession();
  if (!data.session) return showAuthScreen('login');

  state.currentUser = toAppUser(data.session.user);
  showApp();
}

async function submitAuthForm(evt) {
  evt.preventDefault();
  el('authError').classList.add('hidden');

  const email = el('auth_email').value;
  const password = el('auth_password').value;

  try {
    if (authMode === 'setup') {
      await api('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ name: el('auth_name').value, email, password }),
      });
    }

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;

    state.currentUser = toAppUser(data.user);
    await showApp();
  } catch (err) {
    el('authError').textContent = err.message;
    el('authError').classList.remove('hidden');
  }
}

initEventListeners();
el('authForm').addEventListener('submit', submitAuthForm);
checkAuthAndInit();
