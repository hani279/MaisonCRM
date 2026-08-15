const express = require('express');
const db = require('../db');

const router = express.Router();

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

async function withExtras(client) {
  const { rows: lastCallRows } = await db.query(
    'SELECT type, logged_at FROM call_logs WHERE client_id = $1 ORDER BY logged_at DESC, id DESC LIMIT 1',
    [client.id]
  );
  const { rows: labels } = await db.query(
    `SELECT l.id, l.name, l.color FROM labels l
     JOIN client_labels cl ON cl.label_id = l.id
     WHERE cl.client_id = $1 ORDER BY l.name`,
    [client.id]
  );
  return {
    ...client,
    last_contact: lastCallRows[0] ? { type: lastCallRows[0].type, logged_at: lastCallRows[0].logged_at } : null,
    labels,
  };
}

router.get('/export.csv', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, s.name AS stage_name, p.company_name AS referred_by_company, p.contact_name AS referred_by_contact
     FROM clients c
     JOIN pipeline_stages s ON s.id = c.stage_id
     LEFT JOIN partners p ON p.id = c.referred_by_partner_id
     WHERE c.archived_at IS NULL
     ORDER BY s.position, c.name`
  );

  const header = [
    'Name', 'Phone', 'Email', 'Budget', 'Stage', 'Status',
    'Next Action', 'Next Action Date', 'Referred By', 'Referral Fee Note', 'Notes',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    const referredBy = r.referred_by_company || r.referred_by_contact
      ? [r.referred_by_company, r.referred_by_contact].filter(Boolean).join(' - ')
      : '';
    lines.push([
      csvEscape(r.name),
      csvEscape(r.phone),
      csvEscape(r.email),
      csvEscape(r.budget_label),
      csvEscape(r.stage_name),
      csvEscape(r.status),
      csvEscape(r.next_action_label),
      csvEscape(r.next_action_date),
      csvEscape(referredBy),
      csvEscape(r.referral_fee_note),
      csvEscape(r.notes),
    ].join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
  res.send(lines.join('\n'));
});

router.get('/', async (req, res) => {
  const wantArchived = req.query.archived === '1' || req.query.archived === 'true';
  const { rows } = await db.query(
    `SELECT c.*, s.name AS stage_name, s.position AS stage_position,
            p.company_name AS referred_by_company, p.contact_name AS referred_by_contact
     FROM clients c
     JOIN pipeline_stages s ON s.id = c.stage_id
     LEFT JOIN partners p ON p.id = c.referred_by_partner_id
     WHERE c.archived_at IS ${wantArchived ? 'NOT NULL' : 'NULL'}
     ORDER BY s.position, c.name`
  );
  res.json(await Promise.all(rows.map(withExtras)));
});

router.post('/', async (req, res) => {
  const {
    name, phone, email, budget_label, stage_id, status,
    next_action_label, next_action_date, referred_by_partner_id, referral_fee_note, notes,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  let resolvedStageId = stage_id;
  if (!resolvedStageId) {
    const { rows } = await db.query(
      "SELECT id FROM pipeline_stages WHERE pipeline = 'client' ORDER BY position LIMIT 1"
    );
    resolvedStageId = rows[0] ? rows[0].id : null;
  }

  const { rows } = await db.query(
    `INSERT INTO clients
      (name, phone, email, budget_label, stage_id, status, next_action_label, next_action_date, referred_by_partner_id, referral_fee_note, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      name.trim(),
      phone || null,
      email || null,
      budget_label || null,
      resolvedStageId,
      status || 'cold',
      next_action_label || null,
      next_action_date || null,
      referred_by_partner_id || null,
      referral_fee_note || null,
      notes || null,
    ]
  );

  res.status(201).json(await withExtras(rows[0]));
});

router.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  const fields = [
    'name', 'phone', 'email', 'budget_label', 'status',
    'next_action_label', 'next_action_date', 'referred_by_partner_id', 'referral_fee_note', 'notes',
  ];
  const updates = {};
  for (const f of fields) {
    if (f in req.body) updates[f] = req.body[f] === '' ? null : req.body[f];
  }
  if (Object.keys(updates).length === 0) {
    return res.json(await withExtras(existing));
  }

  const keys = Object.keys(updates);
  const setClause = keys.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = keys.map((f) => updates[f]);
  values.push(req.params.id);

  const { rows } = await db.query(
    `UPDATE clients SET ${setClause}, updated_at = now() WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );

  res.json(await withExtras(rows[0]));
});

router.patch('/:id/move', async (req, res) => {
  const { rows: clientRows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  const client = clientRows[0];
  if (!client) return res.status(404).json({ error: 'not found' });

  const { rows: stageRows } = await db.query('SELECT * FROM pipeline_stages WHERE id = $1', [client.stage_id]);
  const currentStage = stageRows[0];
  const { direction, stage_id } = req.body;

  let targetStage;
  if (stage_id) {
    const { rows } = await db.query(
      'SELECT * FROM pipeline_stages WHERE id = $1 AND pipeline = $2',
      [stage_id, currentStage.pipeline]
    );
    targetStage = rows[0];
  } else if (direction === 'next' || direction === 'back') {
    const cmp = direction === 'next' ? '>' : '<';
    const order = direction === 'next' ? 'ASC' : 'DESC';
    const { rows } = await db.query(
      `SELECT * FROM pipeline_stages WHERE pipeline = $1 AND position ${cmp} $2 ORDER BY position ${order} LIMIT 1`,
      [currentStage.pipeline, currentStage.position]
    );
    targetStage = rows[0];
  }

  if (!targetStage) {
    return res.status(400).json({ error: 'no target stage (already at boundary or invalid stage)' });
  }

  const { rows } = await db.query(
    'UPDATE clients SET stage_id = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [targetStage.id, client.id]
  );

  res.json(await withExtras(rows[0]));
});

router.patch('/:id/archive', async (req, res) => {
  const { rows } = await db.query(
    'UPDATE clients SET archived_at = now(), updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await withExtras(rows[0]));
});

router.patch('/:id/restore', async (req, res) => {
  const { rows } = await db.query(
    'UPDATE clients SET archived_at = NULL, updated_at = now() WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(await withExtras(rows[0]));
});

router.post('/:id/labels', async (req, res) => {
  const { rows: clientRows } = await db.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!clientRows[0]) return res.status(404).json({ error: 'not found' });
  const { rows: labelRows } = await db.query('SELECT id FROM labels WHERE id = $1', [req.body.label_id]);
  if (!labelRows[0]) return res.status(404).json({ error: 'label not found' });

  await db.query(
    'INSERT INTO client_labels (client_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.params.id, req.body.label_id]
  );

  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  res.json(await withExtras(rows[0]));
});

router.delete('/:id/labels/:labelId', async (req, res) => {
  await db.query(
    'DELETE FROM client_labels WHERE client_id = $1 AND label_id = $2',
    [req.params.id, req.params.labelId]
  );
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  res.json(await withExtras(rows[0]));
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
