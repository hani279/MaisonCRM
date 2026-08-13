const express = require('express');
const db = require('../db');

const router = express.Router();

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM labels ORDER BY name').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (color && !HEX_COLOR.test(color)) {
    return res.status(400).json({ error: 'color must be a hex value like #0071e3' });
  }

  let info;
  try {
    info = db
      .prepare('INSERT INTO labels (name, color) VALUES (?, ?)')
      .run(name.trim(), color || '#0071e3');
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    throw err;
  }

  const created = db.prepare('SELECT * FROM labels WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
  const color = req.body.color !== undefined ? req.body.color : existing.color;
  if (req.body.color !== undefined && !HEX_COLOR.test(color)) {
    return res.status(400).json({ error: 'color must be a hex value like #0071e3' });
  }

  try {
    db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    throw err;
  }

  res.json(db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM labels WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
