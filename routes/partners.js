const express = require('express');
const db = require('../db');

const router = express.Router();

function withExtras(partner) {
  const referredCount = db
    .prepare('SELECT COUNT(*) AS c FROM clients WHERE referred_by_partner_id = ?')
    .get(partner.id).c;
  return { ...partner, referred_client_count: referredCount };
}

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS stage_name, s.position AS stage_position
       FROM partners p
       JOIN pipeline_stages s ON s.id = p.stage_id
       ORDER BY s.position, p.contact_name`
    )
    .all();
  res.json(rows.map(withExtras));
});

router.post('/', (req, res) => {
  const { company_name, contact_name, mobile, email, notes, stage_id } = req.body;

  if (!contact_name || !contact_name.trim()) {
    return res.status(400).json({ error: 'contact_name is required' });
  }

  let resolvedStageId = stage_id;
  if (!resolvedStageId) {
    const first = db
      .prepare('SELECT id FROM pipeline_stages WHERE pipeline = ? ORDER BY position LIMIT 1')
      .get('partner');
    resolvedStageId = first ? first.id : null;
  }

  const info = db
    .prepare(
      `INSERT INTO partners (company_name, contact_name, mobile, email, notes, stage_id)
       VALUES (@company_name, @contact_name, @mobile, @email, @notes, @stage_id)`
    )
    .run({
      company_name: company_name || null,
      contact_name: contact_name.trim(),
      mobile: mobile || null,
      email: email || null,
      notes: notes || null,
      stage_id: resolvedStageId,
    });

  const created = db.prepare('SELECT * FROM partners WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(withExtras(created));
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const fields = ['company_name', 'contact_name', 'mobile', 'email', 'notes'];
  const updates = {};
  for (const f of fields) {
    if (f in req.body) updates[f] = req.body[f] === '' ? null : req.body[f];
  }
  if (Object.keys(updates).length === 0) {
    return res.json(withExtras(existing));
  }

  const setClause = Object.keys(updates).map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE partners SET ${setClause}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...updates, id: req.params.id });

  const updated = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  res.json(withExtras(updated));
});

router.patch('/:id/move', (req, res) => {
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'not found' });

  const currentStage = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(partner.stage_id);
  const { direction, stage_id } = req.body;

  let targetStage;
  if (stage_id) {
    targetStage = db.prepare('SELECT * FROM pipeline_stages WHERE id = ? AND pipeline = ?').get(stage_id, currentStage.pipeline);
  } else if (direction === 'next' || direction === 'back') {
    const cmp = direction === 'next' ? '>' : '<';
    const order = direction === 'next' ? 'ASC' : 'DESC';
    targetStage = db
      .prepare(
        `SELECT * FROM pipeline_stages WHERE pipeline = ? AND position ${cmp} ? ORDER BY position ${order} LIMIT 1`
      )
      .get(currentStage.pipeline, currentStage.position);
  }

  if (!targetStage) {
    return res.status(400).json({ error: 'no target stage (already at boundary or invalid stage)' });
  }

  db.prepare("UPDATE partners SET stage_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(targetStage.id, partner.id);

  const updated = db.prepare('SELECT * FROM partners WHERE id = ?').get(partner.id);
  res.json(withExtras(updated));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM partners WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
