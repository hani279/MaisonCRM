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
};

const modalMotion = {};
const toggleSprings = {};

const el = (id) => document.getElementById(id);

async function api(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function formatRelative(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T') + 'Z');
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

async function refreshAll() {
  await loadStages();
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

function render() {
  const isClient = state.pipeline === 'client';
  if (!isClient) state.clientView = 'board';

  el('clientViewTabs').classList.toggle('hidden', !isClient);
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === state.clientView);
  });

  const q = state.search.trim().toLowerCase();

  if (!isClient) {
    setPageHeader('Referred Partners', '');
    el('addBtn').textContent = '+ Add Partner';

    const filtered = q
      ? state.partners.filter((r) => [r.company_name, r.contact_name, r.mobile, r.email].join(' ').toLowerCase().includes(q))
      : state.partners;
    renderKanban(filtered, false);
    animateTouchedCard();
    return;
  }

  const [title, subtitle] = VIEW_COPY[state.clientView];
  setPageHeader(title, subtitle);
  el('addBtn').textContent = '+ Add Client';

  const matchesSearch = (c) => [c.name, c.phone, c.email, c.budget_label].join(' ').toLowerCase().includes(q);

  if (state.clientView === 'board') {
    const filtered = q ? state.clients.filter(matchesSearch) : state.clients;
    renderKanban(filtered, true);
    animateTouchedCard();
    return;
  }

  el('board').classList.add('hidden');
  el('listView').classList.remove('hidden');

  if (state.clientView === 'completed') {
    const lastStage = state.stages[state.stages.length - 1];
    let filtered = lastStage ? state.clients.filter((c) => c.stage_id === lastStage.id) : [];
    if (q) filtered = filtered.filter(matchesSearch);
    renderListView(filtered, 'completed');
    animateTouchedCard();
    return;
  }

  const filtered = q ? state.archivedClients.filter(matchesSearch) : state.archivedClients;
  renderListView(filtered, 'archived');
  animateTouchedCard();
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
      <span class="status-dot status-${client.status}" title="${client.status}"></span>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
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
      <span class="status-dot status-${client.status}" title="${client.status}"></span>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
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
      <span class="status-dot status-${client.status}" title="${client.status}"></span>
    </div>
    <div class="card-meta">${escapeHtml(metaParts)}</div>
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
  el('f_budget_label').value = client?.budget_label || '';
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
      budget_label: el('f_budget_label').value,
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

async function loadSettingsPanel() {
  el('importMapping').classList.add('hidden');
  el('importResult').classList.add('hidden');
  el('importFileInput').value = '';
  el('importFileName').textContent = '';
  el('backupStatus').textContent = '';

  try {
    const settings = await api('/api/settings');
    el('backupFolderInput').value = settings.backupFolder || '';
    el('backupStatus').textContent = settings.lastBackupAt
      ? `Last backup: ${formatRelative(settings.lastBackupAt)}`
      : 'No backups yet.';
  } catch (err) {
    el('backupStatus').textContent = 'Could not load settings: ' + err.message;
  }
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

async function saveBackupFolder() {
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ backupFolder: el('backupFolderInput').value }),
    });
    el('backupStatus').textContent = 'Backup folder saved.';
  } catch (err) {
    el('backupStatus').textContent = 'Could not save: ' + err.message;
  }
}

async function runBackupNow() {
  el('backupNowBtn').disabled = true;
  el('backupStatus').textContent = 'Backing up…';
  try {
    const result = await api('/api/settings/backup', { method: 'POST' });
    el('backupStatus').textContent = `Backed up just now to ${result.path}`;
  } catch (err) {
    el('backupStatus').textContent = 'Backup failed: ' + err.message;
  } finally {
    el('backupNowBtn').disabled = false;
  }
}

// ---------- Init ----------

function initEventListeners() {
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
  el('saveBackupFolderBtn').addEventListener('click', saveBackupFolder);
  el('backupNowBtn').addEventListener('click', runBackupNow);

  el('pipelineToggle').addEventListener('click', async (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
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

initEventListeners();
positionToggleIndicator(false);
refreshAll().catch((err) => {
  console.error(err);
  alert('Failed to load data: ' + err.message);
});

api('/api/meta')
  .then((meta) => el('demoBadge').classList.toggle('hidden', !meta.demo))
  .catch(() => {});
