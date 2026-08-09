const state = {
  pipeline: 'client',
  stages: [],
  clients: [],
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

async function loadPartners() {
  state.partners = await api('/api/partners');
}

async function refreshAll() {
  await loadStages();
  if (state.pipeline === 'client') {
    await Promise.all([loadClients(), loadPartners()]);
  } else {
    await loadPartners();
  }
  render();
}

// ---------- Rendering ----------

function render() {
  const isClient = state.pipeline === 'client';
  el('pageTitle').textContent = isClient
    ? 'Maisons Buyers Agency — Client Pipeline'
    : 'Maisons Buyers Agency — Referred Partners';
  el('pageSubtitle').textContent = isClient
    ? 'Track clients from Engage through to Settlement'
    : 'Track referral relationships and fee arrangements';
  el('addBtn').textContent = isClient ? '+ Add Client' : '+ Add Partner';

  const records = isClient ? state.clients : state.partners;
  const q = state.search.trim().toLowerCase();
  const filtered = q
    ? records.filter((r) => {
        const haystack = isClient
          ? [r.name, r.phone, r.email, r.budget_label].join(' ')
          : [r.company_name, r.contact_name, r.mobile, r.email].join(' ');
        return haystack.toLowerCase().includes(q);
      })
    : records;

  el('totalCount').textContent = `${filtered.length} ${isClient ? 'clients' : 'partners'} total`;

  const board = el('board');
  board.innerHTML = '';
  state.stages.forEach((stage, i) => {
    const stageRecords = filtered.filter((r) => r.stage_id === stage.id);
    board.appendChild(renderColumn(stage, i, stageRecords, isClient));
  });

  animateTouchedCard();
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
      <p class="card-name" data-action="edit">${escapeHtml(client.name)}</p>
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

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openClientModal(client));
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
      <p class="card-name" data-action="edit">${escapeHtml(partner.company_name || partner.contact_name)}</p>
    </div>
    <div class="card-meta">${escapeHtml(partner.contact_name)}${metaParts ? ' · ' + escapeHtml(metaParts) : ''}</div>
    <div class="partner-count">${partner.referred_client_count} client${partner.referred_client_count === 1 ? '' : 's'} referred</div>
    <div class="card-actions">
      <button class="btn btn-secondary btn-tiny" data-action="back" ${isFirst ? 'disabled' : ''}>&larr; Back</button>
      <button class="btn btn-add btn-tiny" data-action="next" ${isLast ? 'disabled' : ''}>Next &rarr;</button>
    </div>
  `;

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openPartnerModal(partner));
  card.querySelector('[data-action="back"]').addEventListener('click', () => movePartner(partner.id, 'back'));
  card.querySelector('[data-action="next"]').addEventListener('click', () => movePartner(partner.id, 'next'));

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

// ---------- Add/Edit modal ----------

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

  el('exportBtn').addEventListener('click', () => {
    window.location.href = '/api/clients/export.csv';
  });

  el('pipelineToggle').addEventListener('click', async (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    positionToggleIndicator(true);
    state.pipeline = btn.dataset.pipeline;
    state.search = '';
    el('searchInput').value = '';
    await refreshAll();
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
}

initEventListeners();
positionToggleIndicator(false);
refreshAll().catch((err) => {
  console.error(err);
  alert('Failed to load data: ' + err.message);
});
