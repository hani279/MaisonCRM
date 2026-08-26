const state = {
  page: 'pipeline', // 'pipeline' | 'settings'
  pipeline: 'client',
  clientView: 'board', // 'board' | 'completed' | 'archived'
  stagesByPipeline: { client: [], partner: [] },
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

// Record ids with a move request in flight — a card stays out of this set
// once its optimistic move lands or reverts, and while in it, further move
// clicks for that same id are ignored so two overlapping "move to next
// stage" requests can't land the client two stages over instead of one.
const pendingMoveIds = new Set();

// Same idea as pendingMoveIds, for the archive/restore/permanently-delete
// buttons on Completed/Archived list rows (no confirm() dialog guards those
// first two, so a fast double-click could otherwise fire the request twice).
const pendingActionIds = new Set();

function resortClients() {
  const stages = state.stagesByPipeline.client;
  const positionOf = (stageId) => (stages.find((s) => s.id === stageId) || {}).position || 0;
  state.clients.sort((a, b) => positionOf(a.stage_id) - positionOf(b.stage_id) || a.name.localeCompare(b.name));
}

function resortPartners() {
  const stages = state.stagesByPipeline.partner;
  const positionOf = (stageId) => (stages.find((s) => s.id === stageId) || {}).position || 0;
  state.partners.sort(
    (a, b) => positionOf(a.stage_id) - positionOf(b.stage_id) || (a.contact_name || '').localeCompare(b.contact_name || '')
  );
}

const el = (id) => document.getElementById(id);

// Inline SVG icons — kept as plain markup strings instead of unicode/emoji
// glyphs (⚙ ☎ ← → ×), which render as full-color, platform-inconsistent
// emoji in many fonts instead of a crisp icon matching the rest of the UI.
const ICONS = {
  gear: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="2.7" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 1V11M1 6H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  arrowLeft: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 7H3M3 7L6.5 3.5M3 7L6.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowRight: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  phone: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 2h2l1 3-1.5 1.2a8 8 0 0 0 4.8 4.8L11 9.5l3 1v2a1.5 1.5 0 0 1-1.6 1.5A11.5 11.5 0 0 1 2 3.6 1.5 1.5 0 0 1 3.5 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  close: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

// refreshAll() fires several api() calls in parallel; if the session is bad,
// every one of them gets a 401 around the same time. Without this guard each
// one independently calls showAuthScreen('login') (which clears the error
// banner as part of resetting the form), so whichever 401 resolves last wins
// the race and wipes out the error message a moment after it appeared.
let bouncingToLogin = false;

async function api(url, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (window.supabaseClient) {
    const { data } = await window.supabaseClient.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }

  const res = await fetch(url, { headers, ...opts });
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    // Session expired mid-use — bounce back to the login screen instead of a raw error.
    if (!bouncingToLogin) {
      bouncingToLogin = true;
      showAuthScreen('login');
    }
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
  return {
    // Current options.
    call_1: 'Call 1', call_2: 'Call 2', call_3: 'Call 3', call_4: 'Call 4', message_left: 'Message Left',
    // Kept so older log entries still display correctly.
    call: 'Call', text: 'Text', voicemail: 'Voicemail',
  }[type] || type;
}

// ---------- Loading ----------

async function loadStages() {
  // Stages have no edit UI (fixed at schema-init time), so both pipelines'
  // lists are loaded once up front and cached — never refetched on toggle.
  const [client, partner] = await Promise.all([
    api('/api/stages?pipeline=client'),
    api('/api/stages?pipeline=partner'),
  ]);
  state.stagesByPipeline = { client, partner };
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

// Full load — only needed once, right after sign-in. Both pipelines' clients
// and partners are kept in state together so switching the toggle afterward
// is a synchronous re-render, not a network round trip (see the pipelineToggle
// click handler).
async function refreshAll() {
  await Promise.all([loadStages(), loadLabels(), loadClients(), loadPartners()]);
  if (state.clientView === 'archived') await loadArchivedClients();
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
  state.stagesByPipeline[state.pipeline].forEach((stage, i) => {
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
  // Background data refreshes (e.g. the pipeline toggle's post-switch sync)
  // can resolve after the user has already navigated to Settings. Without
  // this guard, render() would still re-show the board under the settings
  // panel, pushing it down the page.
  if (state.page === 'settings') return;

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
    el('addBtn').innerHTML = `${ICONS.plus} <span>Add Partner</span>`;

    const matchesSearch = (r) => [r.company_name, r.contact_name, r.mobile, r.email].join(' ').toLowerCase().includes(q);
    const filtered = state.partners.filter((r) => (!q || matchesSearch(r)) && matchesFilters(r, false));
    renderKanban(filtered, false);
    animateTouchedCard();
    return;
  }

  const [title, subtitle] = VIEW_COPY[state.clientView];
  setPageHeader(title, subtitle);
  el('addBtn').innerHTML = `${ICONS.plus} <span>Add Client</span>`;

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
    // Named explicitly rather than "the last stage" -- Lost sits after
    // Settlement positionally but isn't a completion.
    const settlementStage = state.stagesByPipeline.client.find((s) => s.name === 'Settlement');
    const filtered = (settlementStage ? state.clients.filter((c) => c.stage_id === settlementStage.id) : [])
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
  const isLast = stageIndex === state.stagesByPipeline.client.length - 1;
  const moving = pendingMoveIds.has(client.id);

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(client.name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
    ${renderLabelChips(client.labels)}
    ${nextAction}
    ${lastContact}
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back" ${isFirst || moving ? 'disabled' : ''}>${ICONS.arrowLeft} Back</button>
      <button class="card-icon-btn" data-action="log-call" title="Log call/text/voicemail">${ICONS.phone}</button>
      <button class="btn btn-add btn-tiny" data-action="next" ${isLast || moving ? 'disabled' : ''}>Next ${ICONS.arrowRight}</button>
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
  const isLast = stageIndex === state.stagesByPipeline.partner.length - 1;
  const moving = pendingMoveIds.has(partner.id);

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(partner.company_name || partner.contact_name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(partner.contact_name)}${metaParts ? ' · ' + escapeHtml(metaParts) : ''}</div>
    ${renderLabelChips(partner.labels)}
    <div class="partner-count">${partner.referred_client_count} client${partner.referred_client_count === 1 ? '' : 's'} referred</div>
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back" ${isFirst || moving ? 'disabled' : ''}>${ICONS.arrowLeft} Back</button>
      <button class="btn btn-add btn-tiny" data-action="next" ${isLast || moving ? 'disabled' : ''}>Next ${ICONS.arrowRight}</button>
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
  const busy = pendingMoveIds.has(client.id) || pendingActionIds.has(client.id);

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(client.name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
    ${renderLabelChips(client.labels)}
    ${lastContact}
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back" ${busy ? 'disabled' : ''}>${ICONS.arrowLeft} Back</button>
      <button class="card-icon-btn" data-action="log-call" title="Log call/text/voicemail">${ICONS.phone}</button>
      <button class="btn btn-secondary btn-tiny" data-action="archive" ${busy ? 'disabled' : ''}>Archive</button>
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
  const busy = pendingActionIds.has(client.id);

  card.innerHTML = `
    <div class="card-top">
      <p class="card-name">${escapeHtml(client.name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
    ${renderLabelChips(client.labels)}
    <div class="last-contact">Archived ${formatRelative(client.archived_at)}</div>
    <div class="card-actions">
      <button class="btn btn-add btn-tiny" data-action="restore" ${busy ? 'disabled' : ''}>Restore</button>
      <button class="btn btn-danger btn-tiny" data-action="delete" ${busy ? 'disabled' : ''}>Delete</button>
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
  if (pendingMoveIds.has(id)) return;
  const client = state.clients.find((c) => c.id === id);
  if (!client) return;
  const stages = state.stagesByPipeline.client;
  const currentIndex = stages.findIndex((s) => s.id === client.stage_id);
  const targetStage = stages[direction === 'next' ? currentIndex + 1 : currentIndex - 1];
  if (!targetStage) return;

  const previousStageId = client.stage_id;
  pendingMoveIds.add(id);
  client.stage_id = targetStage.id;
  resortClients();
  state.lastTouchedId = id;
  render();

  try {
    await api(`/api/clients/${id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) });
  } catch (err) {
    client.stage_id = previousStageId;
    resortClients();
    alert('Could not move client: ' + err.message);
  } finally {
    pendingMoveIds.delete(id);
    render();
  }
}

async function movePartner(id, direction) {
  if (pendingMoveIds.has(id)) return;
  const partner = state.partners.find((p) => p.id === id);
  if (!partner) return;
  const stages = state.stagesByPipeline.partner;
  const currentIndex = stages.findIndex((s) => s.id === partner.stage_id);
  const targetStage = stages[direction === 'next' ? currentIndex + 1 : currentIndex - 1];
  if (!targetStage) return;

  const previousStageId = partner.stage_id;
  pendingMoveIds.add(id);
  partner.stage_id = targetStage.id;
  resortPartners();
  state.lastTouchedId = id;
  render();

  try {
    await api(`/api/partners/${id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) });
  } catch (err) {
    partner.stage_id = previousStageId;
    resortPartners();
    alert('Could not move partner: ' + err.message);
  } finally {
    pendingMoveIds.delete(id);
    render();
  }
}

// ---------- Archive / restore ----------

async function archiveClient(id) {
  if (pendingActionIds.has(id)) return;
  pendingActionIds.add(id);
  render();
  try {
    await api(`/api/clients/${id}/archive`, { method: 'PATCH' });
    state.clients = state.clients.filter((c) => c.id !== id);
  } catch (err) {
    alert('Could not archive: ' + err.message);
  } finally {
    pendingActionIds.delete(id);
    render();
  }
}

async function restoreClient(id) {
  if (pendingActionIds.has(id)) return;
  pendingActionIds.add(id);
  render();
  try {
    const saved = await api(`/api/clients/${id}/restore`, { method: 'PATCH' });
    state.clients.push(saved);
    resortClients();
    state.archivedClients = state.archivedClients.filter((c) => c.id !== id);
    state.clientView = 'board';
    state.lastTouchedId = id;
  } catch (err) {
    alert('Could not restore: ' + err.message);
  } finally {
    pendingActionIds.delete(id);
    render();
  }
}

async function deleteArchivedClient(id) {
  if (pendingActionIds.has(id)) return;
  if (!confirm('Permanently delete this client? This cannot be undone.')) return;
  pendingActionIds.add(id);
  render();
  try {
    await api(`/api/clients/${id}`, { method: 'DELETE' });
    state.archivedClients = state.archivedClients.filter((c) => c.id !== id);
  } catch (err) {
    alert('Could not delete: ' + err.message);
  } finally {
    pendingActionIds.delete(id);
    render();
  }
}

async function toggleArchiveFromModal() {
  const id = el('recordId').value;
  if (!id) return;
  const wasArchived = modalClientArchived;
  const endpoint = wasArchived ? 'restore' : 'archive';

  const btn = el('archiveRecordBtn');
  if (btn.disabled) return;
  btn.disabled = true;

  try {
    const saved = await api(`/api/clients/${id}/${endpoint}`, { method: 'PATCH' });

    if (wasArchived) {
      // Restoring should always land you back on the live board, not the now-empty Archived tab.
      state.clients.push(saved);
      resortClients();
      state.archivedClients = state.archivedClients.filter((c) => c.id !== saved.id);
      state.clientView = 'board';
      state.lastTouchedId = saved.id;
    } else {
      state.clients = state.clients.filter((c) => c.id !== saved.id);
      if (state.clientView === 'archived') await loadArchivedClients();
    }

    closeModal('recordModal');
    render();
  } catch (err) {
    btn.disabled = false;
    alert('Could not update: ' + err.message);
  }
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
  el('f_brief').value = client?.brief || '';
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
  const submitBtn = el('recordForm').querySelector('button[type="submit"]');
  if (submitBtn.disabled) return; // already saving — ignore a repeat click/Enter
  submitBtn.disabled = true;

  try {
    const type = el('recordForm').dataset.type;
    const id = el('recordId').value;
    // Built from selectedLabelIds rather than re-fetched, since the create/update
    // response reflects labels from *before* syncRecordLabels runs.
    const labels = [...selectedLabelIds]
      .map((labelId) => state.labels.find((l) => l.id === labelId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

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
        brief: el('f_brief').value,
        notes: el('f_notes').value,
      };
      const saved = id
        ? await api(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
      await syncRecordLabels('client', saved.id);
      saved.labels = labels;

      const idx = state.clients.findIndex((c) => c.id === saved.id);
      if (idx >= 0) state.clients[idx] = saved;
      else state.clients.push(saved);
      resortClients();
      state.lastTouchedId = saved.id;
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
      saved.labels = labels;

      const idx = state.partners.findIndex((p) => p.id === saved.id);
      if (idx >= 0) state.partners[idx] = saved;
      else state.partners.push(saved);
      resortPartners();
      state.lastTouchedId = saved.id;
    }

    closeModal('recordModal');
    render();
  } catch (err) {
    // Left enabled here (unlike the success path) since the modal stays open
    // for a retry — see openModal() for why success doesn't re-enable it.
    submitBtn.disabled = false;
    alert('Could not save: ' + err.message);
  }
}

async function deleteRecord() {
  const type = el('recordForm').dataset.type;
  const id = el('recordId').value;
  if (!id) return;
  if (!confirm(`Delete this ${type}? This cannot be undone.`)) return;

  const btn = el('deleteRecordBtn');
  if (btn.disabled) return;
  btn.disabled = true;

  try {
    if (type === 'client') {
      await api(`/api/clients/${id}`, { method: 'DELETE' });
      state.clients = state.clients.filter((c) => c.id !== Number(id));
      if (state.clientView === 'archived') await loadArchivedClients();
    } else {
      await api(`/api/partners/${id}`, { method: 'DELETE' });
      state.partners = state.partners.filter((p) => p.id !== Number(id));
    }
    closeModal('recordModal');
    render();
  } catch (err) {
    btn.disabled = false;
    alert('Could not delete: ' + err.message);
  }
}

// ---------- Call log modal ----------

function openCallModal(clientId) {
  el('call_client_id').value = clientId;
  el('call_note').value = '';
  document.querySelector('input[name="call_type"][value="call_1"]').checked = true;
  openModal('callModal');
}

async function submitCallForm(evt) {
  evt.preventDefault();
  const submitBtn = el('callForm').querySelector('button[type="submit"]');
  if (submitBtn.disabled) return;
  submitBtn.disabled = true;

  try {
    const clientId = Number(el('call_client_id').value);
    const type = document.querySelector('input[name="call_type"]:checked').value;
    const note = el('call_note').value;

    const call = await api(`/api/clients/${clientId}/calls`, {
      method: 'POST',
      body: JSON.stringify({ type, note }),
    });

    const client = state.clients.find((c) => c.id === clientId);
    if (client) client.last_contact = { type: call.type, logged_at: call.logged_at };
    state.lastTouchedId = clientId;
    closeModal('callModal');
    render();
  } catch (err) {
    submitBtn.disabled = false;
    alert('Could not log contact: ' + err.message);
  }
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
  // Buttons are deliberately left disabled after a successful submit (see
  // submitRecordForm etc.) because closeModal() fades out over ~300ms rather
  // than hiding immediately — re-enabling right away would let a second
  // click during that fade fire a real duplicate request. Opening the modal
  // fresh is what clears it.
  overlay.querySelectorAll('button:disabled').forEach((btn) => { btn.disabled = false; });

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

  el('settingsBtn').innerHTML = isSettings
    ? `${ICONS.arrowLeft} <span>Back to Pipeline</span>`
    : `${ICONS.gear} <span>Settings</span>`;
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
  loadUsersSection();
}

// ---------- Settings: Users ----------

function loadUsersSection() {
  const user = state.currentUser;
  if (!user) return;

  el('usersSection').classList.toggle('hidden', user.role !== 'admin');
  if (user.role === 'admin') loadUsersList();
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
      ${escapeHtml(u.name)} (${u.role}${u.id === state.currentUser.id ? ' · you' : ''})
      ${u.id !== state.currentUser.id ? `<button type="button" class="label-delete-btn" data-user-id="${u.id}" title="Delete user">${ICONS.close}</button>` : ''}
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
      <button type="button" class="label-delete-btn" data-label-id="${l.id}" title="Delete label">${ICONS.close}</button>
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

  el('pipelineToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn || btn.dataset.pipeline === state.pipeline) return;
    document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    el('pipelineToggle').classList.toggle('is-partner', btn.dataset.pipeline === 'partner');
    positionToggleIndicator(true);
    state.pipeline = btn.dataset.pipeline;
    state.clientView = 'board';
    state.search = '';
    el('searchInput').value = '';
    // Clients/partners/stages are all already in state from the initial load,
    // so the switch itself is an instant re-render — no network wait. Refresh
    // in the background afterward to pick up any changes made elsewhere.
    render();
    Promise.all([loadClients(), loadPartners()]).then(render).catch(() => {});
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
  el('authFormPanel').classList.remove('hidden');
  el('passwordResetPanel').classList.add('hidden');
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
  el('forgotPasswordBtn').classList.toggle('hidden', mode !== 'login');
  el('authError').classList.add('hidden');
  el('authInfo').classList.add('hidden');
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

async function handleForgotPassword() {
  const email = el('auth_email').value.trim();
  el('authError').classList.add('hidden');
  el('authInfo').classList.add('hidden');

  if (!email) {
    el('authError').textContent = 'Enter your email above first.';
    el('authError').classList.remove('hidden');
    return;
  }

  try {
    const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    el('authInfo').textContent = 'Check your email for a password reset link.';
    el('authInfo').classList.remove('hidden');
  } catch (err) {
    el('authError').textContent = err.message;
    el('authError').classList.remove('hidden');
  }
}

function showPasswordResetForm() {
  el('authView').classList.remove('hidden');
  el('authFormPanel').classList.add('hidden');
  el('passwordResetPanel').classList.remove('hidden');
  el('topbarActions').classList.add('hidden');
  el('toolbar').classList.add('hidden');
  el('clientViewTabs').classList.add('hidden');
  el('board').classList.add('hidden');
  el('listView').classList.add('hidden');
  el('settingsView').classList.add('hidden');
  el('filterPanel').classList.add('hidden');
  setPageHeader('Client Pipeline', '');

  el('reset_password').value = '';
  el('reset_password_confirm').value = '';
  el('resetError').classList.add('hidden');
}

async function submitPasswordReset(evt) {
  evt.preventDefault();
  el('resetError').classList.add('hidden');

  const password = el('reset_password').value;
  const confirmPassword = el('reset_password_confirm').value;

  if (password.length < 8) {
    el('resetError').textContent = 'Password must be at least 8 characters.';
    el('resetError').classList.remove('hidden');
    return;
  }
  if (password !== confirmPassword) {
    el('resetError').textContent = 'Passwords do not match.';
    el('resetError').classList.remove('hidden');
    return;
  }

  try {
    const { error } = await window.supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    await window.supabaseClient.auth.signOut();
    showAuthScreen('login');
    el('authInfo').textContent = 'Password updated — sign in with your new password.';
    el('authInfo').classList.remove('hidden');
  } catch (err) {
    el('resetError').textContent = err.message;
    el('resetError').classList.remove('hidden');
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

// A login can be valid at the Supabase Auth level but belong to the *other*
// deployment (real app vs demo) — they share one Supabase project. Checking
// this proactively, right after sign-in, gives one clear error message
// instead of a cascade of 401s from every parallel data-load request.
async function isValidForThisDeployment(user) {
  const meta = await fetch('/api/meta').then((r) => r.json()).catch(() => ({ demo: false }));
  const expectedSchema = meta.demo ? 'demo' : 'public';
  return !!(user.user_metadata && user.user_metadata.schema === expectedSchema);
}

async function checkAuthAndInit() {
  await window.supabaseReady;

  window.onPasswordRecovery = showPasswordResetForm;
  if (window.pendingPasswordRecovery || window.hadRecoveryHashOnLoad) return showPasswordResetForm();

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

  if (!(await isValidForThisDeployment(data.session.user))) {
    await window.supabaseClient.auth.signOut();
    return showAuthScreen('login');
  }

  bouncingToLogin = false;
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

    if (!(await isValidForThisDeployment(data.user))) {
      await window.supabaseClient.auth.signOut();
      throw new Error('That login is not valid for this deployment.');
    }

    bouncingToLogin = false;
    state.currentUser = toAppUser(data.user);
    await showApp();
  } catch (err) {
    el('authError').textContent = err.message;
    el('authError').classList.remove('hidden');
  }
}

initEventListeners();
el('authForm').addEventListener('submit', submitAuthForm);
el('forgotPasswordBtn').addEventListener('click', handleForgotPassword);
el('passwordResetForm').addEventListener('submit', submitPasswordReset);
checkAuthAndInit();
