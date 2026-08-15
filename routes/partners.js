const express = require('express');
const db = require('../db');

const router = express.Router();

async function withExtras(partner) {
  const { rows: countRows } = await db.query(
    'SELECT COUNT(*) AS c FROM clients WHERE referred_by_partner_id = $1',
    [partner.id]
  );
  const { rows: labels } = await db.query(
    `SELECT l.id, l.name, l.color FROM labels l
     JOIN partner_labels pl ON pl.label_id = l.id
     WHERE pl.partner_id = $1 ORDER BY l.name`,
    [partner.id]
  );
  return { ...partner, referred_client_count: Number(countRows[0].c), labels };
}

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, s.name AS stage_name, s.position AS stage_position
     FROM partners p
     JOIN pipeline_stages s ON s.id = p.stage_id
     ORDER BY s.position, p.contact_name`
  );
  res.json(await Promise.all(rows.map(withExtras)));
});

router.post('/', async (req, res) => {
  const { company_name, contact_name, mobile, email, notes, stage_id } = req.body;

  if (!contact_name || !contact_name.trim()) {
    return res.status(400).json({ error: 'contact_name is required' });
  }

  let resolvedStageId = stage_id;
  if (!resolvedStageId) {
    const { rows } = await db.query(
      "SELECT id FROM pipeline_stages WHERE pipeline = 'partner' ORDER BY position LIMIT 1"
    );
    resolvedStageId = rows[0] ? rows[0].id : null;
  }

  const { rows } = await db.query(
    `INSERT INTO partners (company_name, contact_name, mobile, email, notes, stage_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [company_name || null, contact_name.trim(), mobile || null, email || null, notes || null, resolvedStageId]
  );

  res.status(201).json(await withExtras(rows[0]));
});

router.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await db.query('SELECT * FROM partners WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  const fields = ['company_name', 'contact_name', 'mobile', 'email', 'notes'];
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
    `UPDATE partners SET ${setClause}, updated_at = now() WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );

  res.json(await withExtras(rows[0]));
});

router.patch('/:id/move', async (req, res) => {
  const { rows: partnerRows } = await db.query('SELECT * FROM partners WHERE id = $1', [req.params.id]);
  const partner = partnerRows[0];
  if (!partner) return res.status(404).json({ error: 'not found' });

  const { rows: stageRows } = await db.query('SELECT * FROM pipeline_stages WHERE id = $1', [partner.stage_id]);
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
    'UPDATE partners SET stage_id = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [targetStage.id, partner.id]
  );

  res.json(await withExtras(rows[0]));
});

router.post('/:id/labels', async (req, res) => {
  const { rows: partnerRows } = await db.query('SELECT id FROM partners WHERE id = $1', [req.params.id]);
  if (!partnerRows[0]) return res.status(404).json({ error: 'not found' });
  const { rows: labelRows } = await db.query('SELECT id FROM labels WHERE id = $1', [req.body.label_id]);
  if (!labelRows[0]) return res.status(404).json({ error: 'label not found' });

  await db.query(
    'INSERT INTO partner_labels (partner_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [req.params.id, req.body.label_id]
  );

  const { rows } = await db.query('SELECT * FROM partners WHERE id = $1', [req.params.id]);
  res.json(await withExtras(rows[0]));
});

router.delete('/:id/labels/:labelId', async (req, res) => {
  await db.query(
    'DELETE FROM partner_labels WHERE partner_id = $1 AND label_id = $2',
    [req.params.id, req.params.labelId]
  );
  const { rows } = await db.query('SELECT * FROM partners WHERE id = $1', [req.params.id]);
  res.json(await withExtras(rows[0]));
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM partners WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
